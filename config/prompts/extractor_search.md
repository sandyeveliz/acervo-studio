Extract entities, relations, and verifiable facts from these search results about "{query}".

Respond in JSON with "entities", "relations", and "facts".
- entities: list of {{"name": "...", "type": "..."}} (types: place, person, character, organization, universe, publisher, work, technology)
- relations: list of {{"source": "...", "target": "...", "relation": "..."}} (relations: is_a, created_by, alias_of, part_of, set_in, debuted_in, published_by, located_in, belongs_to)
- facts: list of {{"entity": "...", "fact": "..."}}

Only include data explicitly stated in the text. Do NOT invent.

Results:
{text}

JSON: