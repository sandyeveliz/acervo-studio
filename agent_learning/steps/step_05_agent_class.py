"""Step 05 — Clase Agent reutilizable.

Clase Agent con system_prompt configurable, historial interno, tools
registrables con decorador, método chat() async y logging automático.

Demo: dos agentes con distintos system prompts.

Correr: python steps/step_05_agent_class.py
"""

import asyncio
import json
import sys
from functools import wraps
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv
from openai import AsyncOpenAI, APIConnectionError
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.logger import LLMLogger, Timer
from utils.token_counter import count_messages_tokens, count_tokens

load_dotenv()

import os

console = Console()

BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
API_KEY = os.getenv("LMSTUDIO_API_KEY", "lm-studio")
MODEL = os.getenv("LMSTUDIO_MODEL", "qwen2.5-9b-instruct")


class Agent:
    """Agente conversacional con tools, historial y logging."""

    def __init__(self, name: str, system_prompt: str, model: str = MODEL):
        self.name = name
        self.model = model
        self.client = AsyncOpenAI(base_url=BASE_URL, api_key=API_KEY)
        self.logger = LLMLogger(f"step_05_{name}")
        self._tools: dict[str, dict] = {}  # name -> {"schema": ..., "fn": ...}
        self._messages: list[dict] = [{"role": "system", "content": system_prompt}]

    def tool(self, description: str, parameters: dict | None = None):
        """Decorador para registrar una función como tool del agente."""
        def decorator(fn: Callable) -> Callable:
            schema = {
                "type": "function",
                "function": {
                    "name": fn.__name__,
                    "description": description,
                    "parameters": parameters or {"type": "object", "properties": {}, "required": []},
                },
            }
            self._tools[fn.__name__] = {"schema": schema, "fn": fn}

            @wraps(fn)
            def wrapper(*args, **kwargs):
                return fn(*args, **kwargs)
            return wrapper
        return decorator

    @property
    def history(self) -> list[dict]:
        return self._messages

    @property
    def context_tokens(self) -> int:
        return count_messages_tokens(self._messages)

    def reset(self) -> None:
        """Limpia el historial, conservando el system prompt."""
        self._messages = [self._messages[0]]

    async def chat(self, message: str) -> str:
        """Envía un mensaje y retorna la respuesta del modelo."""
        self._messages.append({"role": "user", "content": message})

        tools_list = [t["schema"] for t in self._tools.values()] or None
        tokens_before = self.context_tokens

        with Timer() as timer:
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=self._messages,
                    tools=tools_list,
                )
            except APIConnectionError:
                console.print(
                    f"[bold red][{self.name}] Error:[/] No se pudo conectar a LM Studio."
                )
                return "(error de conexión)"

        response_message = response.choices[0].message
        all_tool_calls = []

        # Procesar tool calls
        while response_message.tool_calls:
            self._messages.append(response_message.model_dump())

            for tc in response_message.tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                except json.JSONDecodeError:
                    fn_args = {}

                tool_entry = self._tools.get(fn_name)
                if tool_entry:
                    result = str(tool_entry["fn"](**fn_args))
                else:
                    result = f"Tool '{fn_name}' no registrada."

                self._messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })
                all_tool_calls.append({"name": fn_name, "args": fn_args, "result": result[:100]})

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=self._messages,
                tools=tools_list,
            )
            response_message = response.choices[0].message

        reply = response_message.content or ""
        self._messages.append({"role": "assistant", "content": reply})

        usage = response.usage
        self.logger.log_call(
            messages=self._messages,
            response_text=reply,
            model=self.model,
            prompt_tokens=usage.prompt_tokens if usage else tokens_before,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            latency_ms=timer.elapsed_ms,
            tool_calls=all_tool_calls or None,
            extra={"agent": self.name, "context_tokens": self.context_tokens},
        )

        return reply


async def demo():
    """Demo con dos agentes que tienen system prompts distintos."""
    console.print(Panel("[bold green]Step 05 — Agent Class Demo[/]", expand=False))

    # Agente 1: Poeta
    poet = Agent(
        name="poeta",
        system_prompt="Sos un poeta argentino. Todo lo que decís tiene rima y metáfora. Respondé en español.",
    )

    # Agente 2: Ingeniero
    engineer = Agent(
        name="ingeniero",
        system_prompt="Sos un ingeniero de software pragmático. Respondé técnicamente, sin rodeos. En español.",
    )

    from datetime import datetime

    # Registrar un tool en el ingeniero
    @engineer.tool(
        description="Retorna la fecha y hora actual",
    )
    def get_current_datetime() -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    prompts = [
        "¿Qué pensás del código?",
        "¿Qué hora es?",
    ]

    for prompt in prompts:
        console.print(f"\n[bold cyan]Pregunta:[/] {prompt}\n")

        for agent in [poet, engineer]:
            reply = await agent.chat(prompt)
            console.print(
                Panel(
                    reply,
                    title=f"[bold]{agent.name}[/] (~{agent.context_tokens} tokens)",
                    border_style="blue" if agent.name == "poeta" else "green",
                )
            )

    # Modo interactivo
    console.print("\n[dim]Ahora podés hablar con ambos. Escribí 'poeta:' o 'ingeniero:' antes del mensaje.[/]")
    console.print("[dim]/quit para salir.[/]\n")

    while True:
        try:
            user_input = console.input("[bold cyan]Vos > [/]")
        except (EOFError, KeyboardInterrupt):
            break

        user_input = user_input.strip()
        if not user_input or user_input == "/quit":
            break

        if user_input.startswith("poeta:"):
            reply = await poet.chat(user_input[6:].strip())
            console.print(Panel(reply, title=f"poeta (~{poet.context_tokens} tok)", border_style="blue"))
        elif user_input.startswith("ingeniero:"):
            reply = await engineer.chat(user_input[10:].strip())
            console.print(Panel(reply, title=f"ingeniero (~{engineer.context_tokens} tok)", border_style="green"))
        else:
            # Ambos responden
            for agent, color in [(poet, "blue"), (engineer, "green")]:
                reply = await agent.chat(user_input)
                console.print(Panel(reply, title=f"{agent.name} (~{agent.context_tokens} tok)", border_style=color))


if __name__ == "__main__":
    asyncio.run(demo())
