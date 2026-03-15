"""Step 04 — Tool Use.

Define dos tools (get_current_datetime, read_file) y deja que el modelo
decida cuándo usarlos. Muestra en el log qué tool se llamó, con qué
argumentos y qué retornó. Los tokens del resultado del tool se suman
al contexto.

Correr: python steps/step_04_tool_use.py
"""

import json
import sys
from datetime import datetime
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

# --- Tool definitions ---

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_datetime",
            "description": "Retorna la fecha y hora actual del sistema.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Lee el contenido de un archivo de texto del disco.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Ruta al archivo a leer.",
                    }
                },
                "required": ["path"],
            },
        },
    },
]


def get_current_datetime() -> str:
    """Retorna fecha y hora actual."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def read_file(path: str) -> str:
    """Lee un archivo de texto. Retorna error si no existe."""
    try:
        p = Path(path)
        if not p.exists():
            return f"Error: el archivo '{path}' no existe."
        if not p.is_file():
            return f"Error: '{path}' no es un archivo."
        content = p.read_text(encoding="utf-8")
        # Limitar a 2000 chars para no explotar el contexto
        if len(content) > 2000:
            return content[:2000] + f"\n\n... (truncado, {len(content)} chars total)"
        return content
    except Exception as e:
        return f"Error al leer '{path}': {e}"


TOOL_FUNCTIONS = {
    "get_current_datetime": get_current_datetime,
    "read_file": read_file,
}


def process_tool_calls(response_message, messages: list[dict], logger: LLMLogger) -> list[dict]:
    """Procesa tool calls del modelo, ejecuta las funciones y agrega resultados."""
    tool_calls = response_message.tool_calls
    logged_calls = []

    for tool_call in tool_calls:
        fn_name = tool_call.function.name
        fn_args_str = tool_call.function.arguments

        try:
            fn_args = json.loads(fn_args_str) if fn_args_str else {}
        except json.JSONDecodeError:
            fn_args = {}

        console.print(f"  [yellow]Tool call:[/] {fn_name}({fn_args})")

        # Ejecutar
        fn = TOOL_FUNCTIONS.get(fn_name)
        if fn:
            result = fn(**fn_args)
        else:
            result = f"Error: tool '{fn_name}' no encontrada."

        result_tokens = count_tokens(result)
        console.print(f"  [green]Resultado:[/] {result[:100]}{'...' if len(result) > 100 else ''}")
        console.print(f"  [dim]Tokens del resultado del tool: {result_tokens}[/]")

        # Agregar al historial
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            }
        )

        logged_calls.append({
            "name": fn_name,
            "arguments": fn_args,
            "result_preview": result[:200],
            "result_tokens": result_tokens,
        })

    return logged_calls


def main():
    console.print(Panel("[bold green]Step 04 — Tool Use[/]", expand=False))
    console.print(
        "[dim]El modelo puede usar tools: get_current_datetime, read_file.\n"
        "Probá: '¿qué hora es?' o 'leé el archivo pyproject.toml'.\n"
        "/quit para salir.[/]\n"
    )

    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)
    logger = LLMLogger("step_04")

    messages: list[dict] = [
        {
            "role": "system",
            "content": (
                "Sos un asistente con acceso a herramientas. "
                "Usá get_current_datetime para saber la fecha/hora "
                "y read_file para leer archivos del disco. "
                "Respondé en español, de forma concisa."
            ),
        }
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
            break

        turn += 1
        messages.append({"role": "user", "content": user_input})

        tokens_before = count_messages_tokens(messages)

        with Timer() as timer:
            response = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=TOOLS,
            )

        response_message = response.choices[0].message
        all_tool_calls = []

        # Loop de tool calls — el modelo puede pedir tools múltiples veces
        while response_message.tool_calls:
            # Agregar el mensaje del asistente con tool_calls al historial
            messages.append(response_message.model_dump())

            console.print(Panel("[yellow]El modelo pidió tools[/]", expand=False))
            logged = process_tool_calls(response_message, messages, logger)
            all_tool_calls.extend(logged)

            tokens_with_tools = count_messages_tokens(messages)
            console.print(f"  [dim]Contexto ahora: ~{tokens_with_tools} tokens[/]\n")

            # Segunda llamada con los resultados de los tools
            with Timer() as timer:
                response = client.chat.completions.create(
                    model=MODEL,
                    messages=messages,
                    tools=TOOLS,
                )
            response_message = response.choices[0].message

        # Respuesta final (sin tool calls)
        reply = response_message.content or "(sin respuesta)"
        messages.append({"role": "assistant", "content": reply})

        console.print(Panel(reply, title="Asistente", border_style="blue"))

        usage = response.usage
        tokens_after = count_messages_tokens(messages)

        info = Text()
        info.append(f"Turno {turn}", style="bold")
        info.append(f" | Tools usados: {len(all_tool_calls)}", style="yellow")
        info.append(f" | Contexto acumulado: ~{tokens_after}", style="cyan")
        info.append(f" | Latencia: {timer.elapsed_ms:.0f}ms", style="dim")
        console.print(info)
        console.print()

        logger.log_call(
            messages=messages,
            response_text=reply,
            model=MODEL,
            prompt_tokens=usage.prompt_tokens if usage else tokens_before,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            latency_ms=timer.elapsed_ms,
            tool_calls=all_tool_calls,
            extra={"turn": turn, "accumulated_context_tokens": tokens_after},
        )


if __name__ == "__main__":
    main()
