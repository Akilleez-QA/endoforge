#!/usr/bin/env python3
"""Read consuming-project data; independent direct computation + manufacturer bracket."""
import hashlib,json,re,math,sys,urllib.request,subprocess
from pathlib import Path
R=Path(__file__).resolve().parents[3];D=R/'campaigns/next50-20261018/quality';C=Path('/home/user/LOCAL LLM/refrigeration-ai-retained-review');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files=[C/'packages/domain/src/calculators/pt-tables.generated.ts',C/'scripts/refrigerant-tables/generate_pt_tables.py'];before={str(p):sha(p)for p in files}
text=files[0].read_text();section=text.split("id: 'R404A',",1)[1].split('rows: [',1)[1].split('\n    ],',1)[0];rows=[list(map(float,m))for m in re.findall(r'\[([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]',section)]
assert len(rows)>20
url='https://forane.arkema.com/files/live/sites/shared_arkema/files/downloads/fluorochemicals/forane-404a-pressure-temperature-chart.pdf';pdf=D/'arkema-r404a-source.pdf'
if not pdf.exists():urllib.request.urlretrieve(url,pdf)
source=subprocess.check_output(['pdftotext','-layout',str(pdf),'-'],text=True);(D/'arkema-r404a-extracted.txt').write_text(source)
# Independent REFPROP9 chart has distinct liquid/vapor headers, source declaration and vapor bracket.
assert 'Vapor'in source and 'REFPROP'in source
assert re.search(r'-22\s+15\.4\s+14\.6',source)and re.search(r'-21\s+16\.1\s+15\.3',source)
sys.path.insert(0,'/home/user/.cache/uv/archive-v0/OwPztc-IDc8m9LpE');import CoolProp;import CoolProp.CoolProp as CP
assert CoolProp.__version__=='8.0.0';atm=14.696;pressure=15.;psi=6894.757293168361
calc=lambda p,q:(CP.PropsSI('T','P',(p+atm)*psi,'Q',q,'R404A.mix')-273.15)*1.8+32
# Inverse ln(P)-1/T interpolation, following consuming project's declared policy.
def table_value(p,phase):
 idx=2 if phase=='dew'else 1;pa=p+atm
 for a,b in zip(rows,rows[1:]):
  if a[idx]<=pa<=b[idx]:
   inv=1/(a[0]+459.67)+(math.log(pa)-math.log(a[idx]))/(math.log(b[idx])-math.log(a[idx]))*(1/(b[0]+459.67)-1/(a[0]+459.67));return 1/inv-459.67
 raise ValueError('outside project table')
dew=calc(15,1);bubble=calc(15,0);tv=table_value(15,'dew');assert -22<=dew<=-21;assert abs(tv-dew)<.05;assert abs(dew-(-21.46))<.01;assert bubble<dew
cases=[{'name':'disputed-15psig-dew','inputs':{'pressure':15,'atmosphere':atm,'phase':'dew'},'projectTable':tv,'independentComputation':dew,'unit':'degF','tolerance':.05,'passed':abs(tv-dew)<.05},{'name':'phase-distinction','bubble':bubble,'dew':dew,'passed':bubble<dew},{'name':'manufacturer-refprop-bracket','dewTemperatureIntervalF':[-22,-21],'pressureVaporPsig':[14.6,15.3],'passed':-22<=dew<=-21,'limit':'Rounded chart establishes bracket; does not independently certify hundredth-degree precision.'}]
for phase,q,idx in [('dew',1,2),('bubble',0,1)]:
 for row in [rows[0],rows[-1]]:
  cp=(CP.PropsSI('P','T',(row[0]-32)/1.8+273.15,'Q',q,'R404A.mix')/psi);cases.append({'name':f'{phase}-boundary-{row[0]}','temperatureF':row[0],'projectPsia':row[idx],'computedPsia':cp,'passed':abs(cp-row[idx])<.0001})
records=[{'key':'saturationTemperature','inputs':{'pressure':15,'atmosphere':atm,'phase':'dew'},'value':tv,'unit':'degF'},{'key':'saturationTemperature','inputs':{'pressure':15,'atmosphere':atm,'phase':'bubble'},'value':table_value(15,'bubble'),'unit':'degF'}]
provider={'version':1,'name':'refrigeration-ai-project-fixture','providerVersion':'CoolProp-8.0.0@2026-10-06','source':str(files[0]),'contentHash':'PENDING','units':{'pressure':'psig','atmosphere':'psia','value':'degF'},'limits':{'saturationTemperature':{'pressure':[rows[0][2]-atm,rows[-1][2]-atm]}},'interpolation':'exact-only','records':records,'provenance':{'sourceHashes':before,'upstreamInterpolation':'ln(P) versus inverse Rankine, no extrapolation','generatorVisibility':'not mounted; trusted eval only','commonSourceDependence':'project table and direct computation both CoolProp8.0.0; manufacturer REFPROP9 chart independent','independentSource':url,'independentSourceHash':sha(pdf)}}
# Use exact same canonical JS hash interface, avoiding cross-language numeric serialization differences.
node=['node','--input-type=module','-e',"import{hash}from './tools/factory_quality/index.mjs';let s='';for await(const c of process.stdin)s+=c;console.log(hash(JSON.parse(s)));" ]
provider['contentHash']=subprocess.check_output(node,input=json.dumps(records),text=True,cwd=R).strip();(D/'provider-fixture.json').write_text(json.dumps(provider,indent=2)+'\n')
assert before=={str(p):sha(p)for p in files};result={'version':1,'passed':all(c['passed']for c in cases),'cases':cases,'providerHash':provider['contentHash'],'sourcesUnchanged':True,'sourceHashes':before,'independentSource':url,'independentSourceHash':sha(pdf),'commonSourceDependence':provider['provenance']['commonSourceDependence'],'limits':['Manufacturer independent crosscheck is bracket only, not hundredth-degree precision.','No critical-state model validated beyond project-declared table endpoints.','No production provider service deployed.']};(D/'reference-regression.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
