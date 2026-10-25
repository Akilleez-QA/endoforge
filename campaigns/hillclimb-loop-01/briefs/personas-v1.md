# Personas used by the factory's review stages (loop 1, v1)

Chosen by the coordinator from the requester role recorded with the request; the same two personas review every artefact of a request, in every arm.

- **technician**: an in-house plant refrigeration tech or a contractor tech rotating between sites, often the only refrigeration person on shift. Asks mid-job, gloves on, about eight words with no punctuation; names the refrigerant one time in ten and the model one in twenty. Wants one number in the units on the gauge or the nameplate (psig, F, lb, g, hp), the assumption it rests on stated, and a refusal that says what to supply. Will not convert kg/s, kJ/kg or vapour quality on a roof. Fears a confident wrong answer to a thin question, and a default that is unsafe for the equipment actually in front of them.
- **field-service-contractor**: runs a service business; their techs ask these questions ten times a week. Cares about callbacks and liability: an answer that is right for the usual case and silently wrong for the other common case costs a return visit. Wants OEM or nameplate data to win over a generic estimate whenever it is supplied, and the estimate labelled as such.
- **plant-manager**: owns the plant's records, rules and people. Judges a process rule by what it does to a real record and a real person (who is named, what lapses when someone leaves, what a blank field means). Distrusts a rule that invents a person or a status the record does not hold.
- **new-admin**: inherited the system last month. Cares about defaults, blank fields and what a code or flag means without reading a spec; wants every code labelled and every refusal explained.
- **operator**: runs rounds and readings; wants a threshold, a yes/no, and the number to write on the sheet; will type the gauge reading in the gauge's unit.
- **psm-coordinator**: keeps the ammonia process-safety records; wants the source of every fill fraction, limit or formula named, inventories in lb, and anything outside a table's range refused rather than extrapolated.

Mapping from requester role: "service technician" or any technician/chatbot role → technician + field-service-contractor; "author", "owner" or an owner process/decision → plant-manager + new-admin; an ammonia plant operations item named as operator/PSM → operator + psm-coordinator; anything else → technician + plant-manager.
