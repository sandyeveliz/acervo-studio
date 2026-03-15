"""Step 02 — Historial acumulativo.

Loop de conversación en terminal con historial que crece turno a turno.
Muestra cuántos tokens lleva el contexto acumulado.
Comando especial: /clear para limpiar historial.

Correr: python steps/step_02_history.py
"""

import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI, APIConnectionError
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


def main():
    console.print(Panel("[bold green]Step 02 — Historial Acumulativo[/]", expand=False))
    console.print("[dim]Escribí tu mensaje. /clear para limpiar historial, /quit para salir.[/]\n")

    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)
    logger = LLMLogger("step_02")

    messages: list[dict] = [
        {"role": "system", "content": "Sos un asistente conversacional. Respondé de forma concisa."}
    ]

    try:
        # Test de conexión
        client.models.list()
    except APIConnectionError:
        console.print(
            "[bold red]Error:[/] No se pudo conectar a LM Studio.\n"
            f"Asegurate de que esté corriendo en [cyan]{BASE_URL}[/]"
        )
        sys.exit(1)

    turn = 0

    while True:
        try:
            user_input = console.input("[bold cyan]Vos > [/]")
        except (EOFError, KeyboardInterrupt):
            console.print("\n[dim]Chau![/]")
            break

        user_input = user_input.strip()
        if not user_input:
            continue

        if user_input == "/quit":
            console.print("[dim]Chau![/]")
            break

        if user_input == "/clear":
            messages = [messages[0]]  # Mantener system prompt
            turn = 0
            console.print("[yellow]Historial limpiado.[/]\n")
            continue

        turn += 1
        messages.append({"role": "user", "content": user_input})

        # Tokens antes de enviar
        tokens_before = count_messages_tokens(messages)

        with Timer() as timer:
            response = client.chat.completions.create(
                model=MODEL,
                messages=messages,
            )

        reply = response.choices[0].message.content
        usage = response.usage

        messages.append({"role": "assistant", "content": reply})

        # Tokens después (con la respuesta incluida)
        tokens_after = count_messages_tokens(messages)

        # Mostrar respuesta
        console.print(Panel(reply, title="Asistente", border_style="blue"))

        # Barra visual de contexto
        prompt_tokens = usage.prompt_tokens if usage else tokens_before
        completion_tokens = usage.completion_tokens if usage else 0

        info = Text()
        info.append(f"Turno {turn}", style="bold")
        info.append(f" | Mensajes: {len(messages)}", style="dim")
        info.append(f" | Tokens enviados: {prompt_tokens}", style="cyan")
        info.append(f" | Tokens respuesta: {completion_tokens}", style="green")
        info.append(f" | Contexto acumulado: ~{tokens_after} tokens", style="yellow")
        info.append(f" | Latencia: {timer.elapsed_ms:.0f}ms", style="dim")
        console.print(info)
        console.print()

        # Loguear
        logger.log_call(
            messages=messages,
            response_text=reply,
            model=MODEL,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=(usage.total_tokens if usage else 0),
            latency_ms=timer.elapsed_ms,
            extra={"turn": turn, "accumulated_context_tokens": tokens_after},
        )


if __name__ == "__main__":
    main()
