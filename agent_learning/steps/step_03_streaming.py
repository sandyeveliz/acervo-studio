"""Step 03 — Streaming.

Lo mismo que step_02 pero con stream=True.
Imprime la respuesta token por token y al final muestra tiempo total
y tokens por segundo.

Correr: python steps/step_03_streaming.py
"""

import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI, APIConnectionError
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


def main():
    console.print(Panel("[bold green]Step 03 — Streaming[/]", expand=False))
    console.print("[dim]Escribí tu mensaje. /clear para limpiar, /quit para salir.[/]\n")

    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)
    logger = LLMLogger("step_03")

    messages: list[dict] = [
        {"role": "system", "content": "Sos un asistente conversacional. Respondé de forma concisa."}
    ]

    try:
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
            messages = [messages[0]]
            turn = 0
            console.print("[yellow]Historial limpiado.[/]\n")
            continue

        turn += 1
        messages.append({"role": "user", "content": user_input})

        tokens_before = count_messages_tokens(messages)

        console.print("[bold blue]Asistente:[/] ", end="")

        full_response = []
        chunk_count = 0
        start_time = time.perf_counter()
        first_token_time = None

        stream = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            stream=True,
        )

        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                if first_token_time is None:
                    first_token_time = time.perf_counter()
                text = delta.content
                console.print(text, end="", highlight=False)
                full_response.append(text)
                chunk_count += 1

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        ttft_ms = ((first_token_time - start_time) * 1000) if first_token_time else 0

        console.print()  # newline después del stream

        reply = "".join(full_response)
        messages.append({"role": "assistant", "content": reply})

        # Contar tokens de la respuesta
        completion_tokens = count_tokens(reply)
        tokens_after = count_messages_tokens(messages)

        # Estadísticas
        tps = completion_tokens / (elapsed_ms / 1000) if elapsed_ms > 0 else 0

        info = Text()
        info.append(f"\nTurno {turn}", style="bold")
        info.append(f" | TTFT: {ttft_ms:.0f}ms", style="magenta")
        info.append(f" | Total: {elapsed_ms:.0f}ms", style="dim")
        info.append(f" | Tokens generados: {completion_tokens}", style="green")
        info.append(f" | {tps:.1f} tok/s", style="bold green")
        info.append(f" | Contexto acumulado: ~{tokens_after}", style="yellow")
        console.print(info)
        console.print()

        logger.log_call(
            messages=messages,
            response_text=reply,
            model=MODEL,
            prompt_tokens=tokens_before,
            completion_tokens=completion_tokens,
            total_tokens=tokens_before + completion_tokens,
            latency_ms=elapsed_ms,
            extra={
                "turn": turn,
                "ttft_ms": round(ttft_ms, 2),
                "tokens_per_second": round(tps, 1),
                "streaming": True,
            },
        )


if __name__ == "__main__":
    main()
