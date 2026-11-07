def task(request, prior, append, _process, _db):
    append(dict(version=0, kind="task", id="task", data=dict(intent=request["result"]["need"], acceptance="test")))
    return dict(seq=len(prior))


def note(request, prior, append, _process, _db):
    append(dict(version=0, kind="admitted_input", id=request["result"]["id"],
                data=dict(task="task", content=request["result"]["id"], origin="caller")))
    return dict(seq=len(prior))


LOOP = dict(admit=task, note=note)
