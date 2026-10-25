"""Conservative reuse and independent challenge records: no model self-promotion."""
import hashlib
import json
from pathlib import Path


def stable(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def identity(signature,facts,references,contract):
    if not isinstance(contract,str) or not contract.strip():raise ValueError('exact normative request contract required')
    return hashlib.sha256(stable({'signature':signature,'facts':facts,'references':references,'contract':contract}).encode()).hexdigest()


def register(catalog,artifact,signature,facts,references,contract,publication):
    if publication.get('published') is not True or publication.get('outcome') not in ['passed','publication_recovered']:
        raise ValueError('trusted publication receipt required')
    artifact=Path(artifact)
    entry={'version':1,'compatibility':identity(signature,facts,references,contract),'artifact':str(artifact.resolve()),'artifactSha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'signature':signature,'facts':facts,'references':references,'contract':contract,'publication':publication}
    p=Path(catalog);p.mkdir(parents=True,exist_ok=True)
    with (p/(entry['compatibility']+'.json')).open('x') as f:json.dump(entry,f,indent=2);f.write('\n')
    return entry


def lookup(catalog,signature,facts,references,contract):
    p=Path(catalog)/(identity(signature,facts,references,contract)+'.json')
    if not p.is_file() or p.is_symlink():return {'outcome':'miss'}
    entry=json.loads(p.read_text());artifact=Path(entry['artifact'])
    if artifact.is_symlink() or not artifact.is_file() or hashlib.sha256(artifact.read_bytes()).hexdigest()!=entry['artifactSha256']:
        return {'outcome':'invalidated','reason':'artifact identity changed'}
    if entry['compatibility']!=identity(signature,facts,references,contract):raise ValueError('catalog identity mismatch')
    return {'outcome':'reused','entry':entry}


def challenge(path,frozen_path,requirement,evidence,registry):
    """Accept only outcome-independent evidence identity; never rewrite frozen content."""
    required={'source','sourceSha256','computation','computationSha256','independentOfCandidate','resolution'}
    if not isinstance(evidence,dict) or set(evidence)!=required:raise ValueError('evidence envelope')
    frozen_path=Path(frozen_path)
    if frozen_path.is_symlink() or not frozen_path.is_file():raise ValueError('actual frozen eval required')
    from tools.factory_campaign.pipeline import quality
    cases=quality('cases',frozen_path)
    frozen=json.loads(frozen_path.read_text())
    source_case=next((c for c in cases if c.get('id')==requirement.get('caseId')),None)
    if source_case is None or source_case.get('inputs')!=requirement.get('inputs') or source_case.get('unit')!=requirement.get('unit') or source_case.get('expect')!=requirement.get('expect') or source_case.get('tolerance')!=requirement.get('tolerance') or frozen['suite']['signature']['name']!=requirement.get('referenceKey'):
        raise ValueError('challenge must name the exact frozen claim')
    frozen_hash=hashlib.sha256(frozen_path.read_bytes()).hexdigest()
    if evidence['independentOfCandidate'] is not True or not evidence['source']:
        raise ValueError('independent source required')
    for key in ['sourceSha256','computationSha256']:
        value=evidence[key]
        if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):raise ValueError('evidence identity')
    for key,digest_key in [('source','sourceSha256'),('computation','computationSha256')]:
        actual=Path(evidence[key])
        if actual.is_symlink() or not actual.is_file() or hashlib.sha256(actual.read_bytes()).hexdigest()!=evidence[digest_key]:
            raise ValueError('source/computation bytes do not match evidence')
        if registry.get(str(actual.resolve()))!=evidence[digest_key]:raise ValueError('evidence absent from independent trusted registry')
    # Initial narrow resolver: exact arithmetic from a separately pinned source fixture.
    # Other scientific challenges stay unresolved until a qualified provider supports them.
    data=json.loads(Path(evidence['computation']).read_text())
    provider=data.get('provider',{})
    records=provider.get('records',[])
    if hashlib.sha256(stable(records).encode()).hexdigest()!=provider.get('contentHash') or data.get('sourceHash')!=evidence['sourceSha256']:
        raise ValueError('independent provider identity mismatch')
    matches=[r for r in records if r.get('key')==requirement.get('referenceKey') and r.get('inputs')==requirement.get('inputs') and r.get('unit')==requirement.get('unit')]
    if len(matches)!=1:raise ValueError('evidence is not about the same function, inputs and units')
    calc=data.get('calculation',{})
    from fractions import Fraction
    if set(calc)!= {'method','numerator','denominator','result'} or not calc['denominator']:
        raise ValueError('unsupported independent computation')
    actual_value=float(Fraction(calc['numerator'],calc['denominator']))
    if actual_value!=calc['result'] or actual_value!=matches[0].get('value'):raise ValueError('independent arithmetic contradiction')
    if 'expect' not in requirement or 'tolerance' not in requirement:raise ValueError('requirement lacks comparable value')
    contradicted=abs(requirement['expect']-actual_value)>requirement['tolerance']
    if evidence['resolution']=='eval-invalid' and not contradicted:raise ValueError('source does not contradict frozen eval')
    if evidence['resolution'] not in ['eval-invalid','candidate-defect','missing-data','unresolved-dispute']:
        raise ValueError('resolution')
    record={'version':1,'frozenSuiteHash':frozen_hash,'requirement':requirement,'evidence':evidence,'action':'new-eval-version-required' if evidence['resolution']=='eval-invalid' else 'preserve-frozen-eval'}
    with Path(path).open('x') as f:json.dump(record,f,indent=2);f.write('\n')
    return record
