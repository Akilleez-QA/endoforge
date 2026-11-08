import json, re, sys, collections
s2a, mutants, corpus, output = sys.argv[1:5]
escaped = {r['mutant'] for r in map(json.loads, open(s2a)) if r['promoted'] and r['cohort'] == 'P21'}
rows = [r for r in map(json.loads, open(mutants)) if r['mutant'] in escaped]
def pristine(key):
    run, i = key.split('/')
    return json.load(open(f'{corpus}/{run}/thread/{i}/candidate/glue.json'))
def changes(a, b):
    out = []
    for ea, eb in zip(a['exports'], b['exports']):
        for x, y in zip(ea['args'] + [ea['result']], eb['args'] + [eb['result']]):
            for k in set(x) | set(y):
                if x.get(k) != y.get(k): out.append((ea['name'], x.get('name', '<result>'), k, x.get(k), y.get(k), x['kind']))
    return out
def dim(u):
    if not isinstance(u, str): return None
    s = u.lower().replace('°', 'deg ').strip()
    if re.search(r'selected|caller-labelled|same .* as|mass or', s): return 'generic'
    if re.search(r'\bcode\b|status|state|flag|mask|action|classification|comparison|identifier|index$|ordinal|indicator|membership|inclusion|decision|label|role|presence|assessment|type|scale|contribution|position', s) and 'day index' not in s: return None
    if re.search(r'difference|delta', s) and re.search(r'deg|\bf\b|\bc\b|\bk\b|fahrenheit|celsius', s): return 'dT'
    if s.startswith('k of superheat'): return 'dT'
    if re.search(r'(deg ?)?\b(f|c|degf|degc)\b|fahrenheit|celsius', s): return 'T'
    if re.search(r'% ?rh', s): return 'RH%'
    if re.search(r'^%|percent|% (of|by)', s): return '%'
    if re.search(r'psi|kpa|\bbar\b', s): return 'P'
    if re.search(r'kg/s|mass/time', s): return 'mdot'
    if re.search(r'mass fed / mass|mass/mass|mass liquid/mass|fraction|dimensionless|ratio', s): return '1'
    if re.search(r'^g$|gram', s): return 'mass'
    if re.search(r'^in$|feet|metre|meter', s): return 'L'
    if re.search(r'since|unix|epoch|day index', s): return 'tpoint'
    if re.search(r'^(utc )?days?$|^ms$', s): return 'dt'
    if re.search(r'circuits|characters|code units', s): return 'count'
    return None
def classify(r, ch):
    if r['op'] == 'glue_precision_changed': return 'precision'
    if r['op'] == 'glue_code_labels_swapped':
        return 'code_labels:reserved' if re.search(r'reserved|never', ' '.join(ch[0][3].values()).lower()) else 'code_labels:other'
    a, b = (dim(ch[0][3]), dim(ch[0][4])) if r['op'] == 'glue_result_unit_swapped' else (dim(ch[0][3]), dim(ch[1][3]))
    if a is None and b is None: return 'label_only'
    if (a is None) != (b is None): return 'label_vs_physical'
    if 'generic' in (a, b): return 'generic_physical'
    if a == b: return 'same_dim:' + a
    if {a, b} == {'T', 'dT'}: return 'affine_point_vs_difference'
    if {a, b} == {'tpoint', 'dt'}: return 'time_point_vs_duration'
    return 'dim_mismatch:' + a + '|' + b
result = {r['mutant']: classify(r, changes(pristine(r['key']), json.loads(r['glue']))) for r in rows}
json.dump(result, open(output, 'w'), indent=0, sort_keys=True)
print(len(result), collections.Counter(result.values()).most_common())
