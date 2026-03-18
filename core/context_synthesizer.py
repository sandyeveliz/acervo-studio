"""Context Synthesizer — re-exports from acervo.synthesizer.

All synthesis logic now lives in the acervo package.
This module exists for backward compatibility during migration.
"""

from acervo.synthesizer import (  # noqa: F401
    synthesize,
    _find_user_identity,
    _get_neighbor_ids,
    _node_relevant,
    _render_node,
    _get_relations,
    _reverse_relation,
)
