"""Step 06 — Dos agentes en paralelo con asyncio.

Un agente es el "usuario simulado", el otro es el "asistente".
El usuario simulado manda mensajes cada 2 segundos.
Se muestra en tiempo real los mensajes de ambos con timestamps.

Correr: python steps/step_06_two_agents.py
"""

import asyncio
import json
import sys
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from openai import AsyncOpenAI, APIConnectionError
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.logger import LLMLogger, Timer
from utils.token_counter import count_messages_tokens

load_dotenv()

import os

console = Console()

BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
API_KEY = os.getenv("LMSTUDIO_API_KEY", "lm-studio")
MODEL = os.getenv("LMSTUDIO_MODEL", "qwen2.5-9b-instruct")

# Lock para serializar prints (evitar output mezclado)
print_lock = asyncio.Lock()


class Agent:
    """Agente async simplificado para step_06."""

    def __init__(self, name: str, system_prompt: str, model: str = MODEL):
        self.name = name
        self.model = model
        self.client = AsyncOpenAI(base_url=BASE_URL, api_key=API_KEY)
        self.logger = LLMLogger(f"step_06_{name}")
        self._messages: list[dict] = [{"role": "system", "content": system_prompt}]

    @property
    def context_tokens(self) -> int:
        return count_messages_tokens(self._messages)

    def reset(self) -> None:
        self._messages = [self._messages[0]]

    async def chat(self, message: str) -> str:
        self._messages.append({"role": "user", "content": message})

        with Timer() as timer:
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=self._messages,
                )
            except APIConnectionError:
                return "(error de conexión a LM Studio)"

        reply = response.choices[0].message.content or ""
        self._messages.append({"role": "assistant", "content": reply})

        usage = response.usage
        self.logger.log_call(
            messages=self._messages,
            response_text=reply,
            model=self.model,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            latency_ms=timer.elapsed_ms,
            extra={"agent": self.name, "context_tokens": self.context_tokens},
        )

        return reply


async def run_conversation(
    user_agent: Agent,
    assistant_agent: Agent,
    initial_topic: str,
    num_turns: int = 5,
    delay_seconds: float = 2.0,
):
    """Ejecuta una conversación entre dos agentes."""

    async def log_message(agent_name: str, message: str, color: str, tokens: int):
        async with print_lock:
            ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            console.print(
                Panel(
                    message,
                    title=f"[{color}]{agent_name}[/] [{ts}] (~{tokens} tok)",
                    border_style=color,
                )
            )

    # El usuario simulado arranca la conversación
    user_message = await user_agent.chat(
        f"Generá una pregunta interesante sobre: {initial_topic}. "
        "Solo escribí la pregunta, nada más."
    )
    await log_message("Usuario Simulado", user_message, "yellow", user_agent.context_tokens)

    for turn in range(num_turns):
        await asyncio.sleep(delay_seconds)

        # Asistente responde
        assistant_reply = await assistant_agent.chat(user_message)
        await log_message("Asistente", assistant_reply, "blue", assistant_agent.context_tokens)

        await asyncio.sleep(delay_seconds)

        # Usuario simulado genera siguiente pregunta basada en la respuesta
        user_message = await user_agent.chat(
            f"El asistente respondió: '{assistant_reply[:200]}'. "
            "Hacé una pregunta de seguimiento. Solo la pregunta."
        )
        await log_message("Usuario Simulado", user_message, "yellow", user_agent.context_tokens)

    # Respuesta final del asistente
    await asyncio.sleep(delay_seconds)
    final_reply = await assistant_agent.chat(user_message)
    await log_message("Asistente", final_reply, "blue", assistant_agent.context_tokens)


async def main():
    console.print(Panel("[bold green]Step 06 — Dos Agentes en Paralelo[/]", expand=False))

    # Test de conexión
    client = AsyncOpenAI(base_url=BASE_URL, api_key=API_KEY)
    try:
        await client.models.list()
    except APIConnectionError:
        console.print(
            "[bold red]Error:[/] No se pudo conectar a LM Studio.\n"
            f"Asegurate de que esté corriendo en [cyan]{BASE_URL}[/]"
        )
        sys.exit(1)

    # Conversación 1: sobre programación
    user1 = Agent(
        name="user_sim_1",
        system_prompt=(
            "Sos un estudiante curioso de programación. "
            "Hacés preguntas concretas y cortas. En español."
        ),
    )
    assistant1 = Agent(
        name="assistant_1",
        system_prompt=(
            "Sos un tutor de programación experto. "
            "Respondés de forma clara y concisa, con ejemplos cuando ayuda. En español."
        ),
    )

    # Conversación 2: sobre cocina
    user2 = Agent(
        name="user_sim_2",
        system_prompt=(
            "Sos alguien que quiere aprender a cocinar. "
            "Hacés preguntas prácticas y cortas. En español."
        ),
    )
    assistant2 = Agent(
        name="assistant_2",
        system_prompt=(
            "Sos un chef argentino con mucha experiencia. "
            "Respondés con tips prácticos y onda. En español."
        ),
    )

    console.print("[dim]Lanzando dos conversaciones en paralelo...[/]\n")
    console.print("[yellow]Conversación 1:[/] Programación")
    console.print("[yellow]Conversación 2:[/] Cocina\n")

    # Correr ambas conversaciones en paralelo
    await asyncio.gather(
        run_conversation(user1, assistant1, "asyncio en Python", num_turns=3, delay_seconds=1.0),
        run_conversation(user2, assistant2, "asado argentino", num_turns=3, delay_seconds=1.5),
    )

    console.print("\n[bold green]Conversaciones completadas.[/]")

    # Resumen final
    async with print_lock:
        console.print("\n[bold]Resumen de contexto:[/]")
        for agent in [user1, assistant1, user2, assistant2]:
            console.print(f"  {agent.name}: ~{agent.context_tokens} tokens, {len(agent._messages)} mensajes")


if __name__ == "__main__":
    asyncio.run(main())
