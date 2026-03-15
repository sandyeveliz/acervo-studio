"""Step 01 — Conexión básica a LM Studio.

Conecta a LM Studio, manda un mensaje simple, imprime la respuesta
y muestra el uso de tokens. Loguea la llamada completa.

Correr: python steps/step_01_hello_lmstudio.py
"""

import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI, APIConnectionError
from rich.console import Console
from rich.panel import Panel

# Agregar el directorio raíz al path para imports
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
    console.print(Panel("[bold green]Step 01 — Hello LM Studio[/]", expand=False))

    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)
    logger = LLMLogger("step_01")

    messages = [{"role": "user", "content": "Hola, presentate en una línea."}]

    # Estimar tokens antes de enviar
    estimated_tokens = count_messages_tokens(messages)
    console.print(f"[dim]Tokens estimados del prompt: {estimated_tokens}[/]")

    try:
        with Timer() as timer:
            response = client.chat.completions.create(
                model=MODEL,
                messages=messages,
            )
    except APIConnectionError:
        console.print(
            "[bold red]Error:[/] No se pudo conectar a LM Studio.\n"
            f"Asegurate de que esté corriendo en [cyan]{BASE_URL}[/]"
        )
        sys.exit(1)

    # Extraer respuesta
    reply = response.choices[0].message.content
    usage = response.usage

    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    total_tokens = usage.total_tokens if usage else 0

    # Mostrar respuesta
    console.print(Panel(reply, title="Respuesta del modelo", border_style="blue"))

    # Mostrar tokens
    logger.print_token_summary(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        latency_ms=timer.elapsed_ms,
    )

    # Loguear
    logger.log_call(
        messages=messages,
        response_text=reply,
        model=MODEL,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        latency_ms=timer.elapsed_ms,
    )

    console.print(f"[dim]Log guardado en: {logger.log_file}[/]")


if __name__ == "__main__":
    main()
