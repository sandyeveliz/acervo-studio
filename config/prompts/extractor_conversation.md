Extract entities, semantic relations, and facts from this conversation.

RULES:
- Each fact must be a concrete statement ABOUT the entity.
- Each fact has "speaker": "user" or "assistant" depending on who said it.
- Do NOT add general knowledge. Only what was explicitly stated.
- Extract category and hierarchy relations when applicable.

Entity types: place, person, character, organization, universe, publisher, technology, work, project, document, rule

Relation types:
- is_a: classification (Batman is_a character, Gotham is_a place)
- created_by: creator (Batman created_by Bill Finger)
- alias_of: alternate identity (Batman alias_of Bruce Wayne)
- part_of: membership in universe/group (Batman part_of DC Universe)
- set_in: narrative location (Batman set_in Gotham City)
- debuted_in: first appearance (Batman debuted_in Detective Comics)
- published_by: publisher (Detective Comics published_by DC Comics)
- located_in, belongs_to, related_to, works_at, lives_in: general relations

Example:
User: Batman was created by Bill Finger in 1939
Assistant: Batman is a DC Comics character, his real name is Bruce Wayne.
JSON: {{"entities":[{{"name":"Batman","type":"character"}},{{"name":"Bill Finger","type":"person"}},{{"name":"DC Universe","type":"universe"}},{{"name":"Bruce Wayne","type":"person"}},{{"name":"Gotham City","type":"place"}}],"relations":[{{"source":"Batman","target":"Bill Finger","relation":"created_by"}},{{"source":"Batman","target":"DC Universe","relation":"part_of"}},{{"source":"Batman","target":"Bruce Wayne","relation":"alias_of"}}],"facts":[{{"entity":"Batman","fact":"Was created in 1939","speaker":"user"}},{{"entity":"Batman","fact":"Is a DC Comics character","speaker":"assistant"}}]}}

User: {user_msg}
Assistant: {assistant_msg}
JSON: