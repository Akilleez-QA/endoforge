"""Exact visually inspected Arkema chart subset; no interpolation or inverse approximation."""
import pathlib,json,hashlib,re,copy
D=pathlib.Path(__file__).resolve().parent
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
rows={'410a':{40:(118.8,118.4),45:(130.6,130.1),100:(318.6,317.6),105:(341.9,340.9),110:(366.4,365.4)},'22':{40:(68.6,),45:(76.1,),100:(195.9,),105:(210.8,),110:(226.4,)}}
records=[];sources=[]
for fluid,table in rows.items():
 text=(D/f'arkema-r{fluid}.txt').read_text(); phases=['liquid','vapor'] if fluid=='410a' else ['single-component-saturation']
 sources.append({'fluid':'R410A' if fluid=='410a' else 'R22','url':f'https://forane.arkema.com/files/live/sites/shared_arkema/files/downloads/fluorochemicals/forane-{fluid}-pressure-temperature-chart.pdf','pdfSha256':H(D/f'arkema-r{fluid}.pdf'),'textSha256':H(D/f'arkema-r{fluid}.txt'),'renderSha256':H(D/f'arkema-r{fluid}.png'),'page':1,'visualReview':'Title psig, temperature F, liquid/vapor columns R410A; single pressure column R22; selected positive-pressure rows verified in rendered page','providerBasis':'Arkema chart cites NIST REFPROP9.0, 2010; published rounded 0.1psig values','candidateIndependent':True})
 for t,vals in table.items():
  pat=r'(?<![\d.-])'+str(t)+r'\s+'+r'\s+'.join(re.escape(str(v)) for v in vals)+r'\s+'
  matches=[line for line in text.splitlines() if re.search(pat,line)]
  assert len(matches)==1,(fluid,t,matches)
  for phase,value in zip(phases,vals): records.append({'fluid':'R410A' if fluid=='410a' else 'R22','temperatureF':t,'pressurePsig':value,'phase':phase,'quantity':'saturation-pressure','sourcePdfSha256':sources[-1]['pdfSha256'],'sourceTextLineSha256':hashlib.sha256(matches[0].encode()).hexdigest(),'precisionPsig':0.1})
def query(q):
 if q.get('quantity')!='saturation-pressure':return {'status':'missing-exact-reference','reason':'No inverse interpolation or NH3 thermophysical properties supplied by this exact PT subset.'}
 if q.get('outputUnit')!='psig':return {'status':'unsupported-output-unit','reason':'Exact registered unit psig required; no silent conversion.'}
 rs=[r for r in records if r['fluid']==q.get('fluid') and r['temperatureF']==q.get('temperatureF')]
 if not rs:return {'status':'missing-exact-reference'}
 phase=q.get('phase')
 if phase=='requires-explicit-phase-basis':
  if q['fluid']=='R410A':return {'status':'phase-choice-required','alternatives':rs}
  # Pure R22 has one saturation-pressure column, independently verified in source.
  return {'status':'exact-source-records','records':rs}
 if phase not in {'liquid','vapor','single-component-saturation'}:return {'status':'unsupported-phase','reason':'Explicit registered phase required.'}
 rs=[r for r in rs if r['phase']==phase]
 if not rs:return {'status':'unsupported-phase','reason':'No exact record for requested phase.'}
 return {'status':'exact-source-records','records':rs}
req=D.parents[1]/'audit/historical-development/reference-query-requirements.json'
requirements=json.loads(req.read_text()); bindings=[{**{k:v for k,v in x.items() if k!='queries'},'bindings':[{'query':q,**query(q)} for q in x['queries']]} for x in requirements]
controls=[]
for q in [{'quantity':'saturation-pressure','fluid':'R410A','temperatureF':40.01},{'quantity':'liquid-saturation-temperature','fluid':'R410A','pressurePsig':343},{'quantity':'saturation-pressure','fluid':'NH3','temperatureF':0}]:
 q.setdefault('outputUnit','psig');result=query(q);assert result['status']=='missing-exact-reference';controls.append({'query':q,'result':result,'passed':True})
q={'quantity':'saturation-pressure','fluid':'R410A','temperatureF':40,'phase':'requires-explicit-phase-basis','outputUnit':'psig'};r=query(q);assert r['status']=='phase-choice-required' and len(r['alternatives'])==2;controls.append({'query':q,'result':r['status'],'passed':True})
assert next(r for r in records if r['fluid']=='R22' and r['temperatureF']==40)['pressurePsig']==68.6
controls.append({'test':'R22 exact40F is68.6psig','passed':True})
for phase,value in [('liquid',118.8),('vapor',118.4)]:
 q={'quantity':'saturation-pressure','fluid':'R410A','temperatureF':40,'phase':phase,'outputUnit':'psig'}
 r=query(q);assert r['status']=='exact-source-records' and len(r['records'])==1 and r['records'][0]['pressurePsig']==value
 controls.append({'query':q,'result':r,'passed':True})
for change,status in [({'outputUnit':'kPa'},'unsupported-output-unit'),({'outputUnit':None},'unsupported-output-unit'),({'phase':'dew'},'unsupported-phase'),({'phase':None},'unsupported-phase'),({'phase':'single-component-saturation'},'unsupported-phase')]:
 q={'quantity':'saturation-pressure','fluid':'R410A','temperatureF':40,'phase':'liquid','outputUnit':'psig',**change};r=query(q);assert r['status']==status
 controls.append({'query':q,'result':r,'passed':True})
out={'version':1,'sources':sources,'records':records,'requestRequirementsSha256':H(req),'bindings':bindings,'controls':controls,'conflicts':[{'query':'R410A liquid343psig->100F','status':'contradicted-exact100F-row','explanation':'Exact100F liquid row is318.6psig;343psig is not an exact registered gridpoint. No replacement temperature inferred.'},{'query':'R410A liquid365psig->110F','status':'not-exact-source-query','explanation':'110F liquid366.4/vapor365.4psig.365psig is not an exact registered gridpoint; no inverse value provided.'}],'limits':['Rounded published chart records only; no precision beyond source rounding.','Liquid/vapor phase decision remains explicit for blends.','No nearest point, interpolation, extrapolation or borrowed generator table.','NH3 density/hfg and343/365psig inverse queries remain unqualified.']}
(D/'exact-pt-reference.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'records':len(records),'controls':len(controls),'bindingSources':len(bindings),'path':str(D/'exact-pt-reference.json')}))
