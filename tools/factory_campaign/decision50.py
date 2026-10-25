"""Deterministic comparison decision; incumbent preserved, no model judging."""
import json,statistics
from pathlib import Path
from tools.factory_campaign import pipeline as p
C=p.REPO/'campaigns/next50-20261018'

def main():
    dev=json.loads((C/'control/paired-development.json').read_text());hold=json.loads((C/'control/holdout-result.json').read_text());aa=json.loads((C/'control/repeatability.json').read_text());pre=json.loads((C/'control/comparison-precommit.json').read_text())
    pairs=[]
    for name,rows in [('development',dev['rows']),('holdout',hold['rows'])]:
        for req in dict.fromkeys(r['request']for r in rows):
            group={r['arm']:r for r in rows if r['request']==req};a=group['incumbent'];b=group['candidate'];pairs.append({'stratum':name,'request':req,'incumbentValid':a['completedValid'],'candidateValid':b['completedValid'],'difference':int(b['completedValid'])-int(a['completedValid'])})
    improvements={name:sum(x['difference']for x in pairs if x['stratum']==name)for name in ['development','holdout']}
    resolution=json.loads((Path(hold['path'])/'resolution.json').read_text());deviation=bool(resolution['corrections'])
    adopt=all(value>0 for value in improvements.values())and hold['passed']and not deviation
    choice='adopt'if adopt else'reject'if any(value<0 for value in improvements.values())else'no-evidence'
    cost={}
    for arm in ['incumbent','candidate']:
        rows=[r for r in dev['rows']if r['arm']==arm];cost[arm]={'developmentTokens':sum(r['modelTokens']for r in rows),'developmentMedianWallMs':statistics.median(r['wallMs']for r in rows)}
    discordant=[x for x in pairs if x['difference']];report={'version':1,'decision':choice,'adopted':adopt,'scope':'five synthetic scalar requests, not real refrigeration or whole-stack effectiveness','pairs':pairs,'pairedDifferences':improvements,'discordantPairs':len(discordant),'exactPairedSignTestP':1 if not discordant else None,'uncertainty':'Three development and two synthetic holdout requests provide no precise general-effect estimate. No causal speed claim from historical unbalanced workloads.','cost':cost,'aa':aa,'rawHoldoutWriterAgreement':False,'independentSourceResolutions':len(resolution['corrections']),'evalProtocolImplementationDeviation':True,'holdoutFinalizationRecovery':'A missing summary variable failed after generation+consumer receipts were durable. Finalization reused them with zero model calls; no stage reran.','consumerAllCompleted':hold['passed'],'forecast':pre['forecast'],'forecastDecisionMatched':choice==pre['forecast']['expectedDecision'],'rollback':{'incumbentPreserved':True,'applicationChanged':False,'productionDeployment':False},'sourcePrecommitHash':p.digest(C/'control/comparison-precommit.json')}
    p.write(C/'control/decision.json',report)
    (C/'DECISION.md').write_text('''# Decision: no evidence to adopt

Both frozen generation policies completed all three development requests and both new synthetic holdout requests under the common executable evals. Fresh agent-consumer inputs also completed on both holdout arms. The paired completion difference is zero; the tiny experiment establishes no improvement. Keep the incumbent. No application or production change is adopted.

The repeatability run completed 6/6. Historical incumbent/fast-path replays have separate semantic failures, interface limitations and non-comparable cost histories; they are not converted into a whole-stack speed/quality win.

The holdout exposed one Qwen example-table arithmetic error before any generator ran. The original failed freeze and both writer outputs remain intact. A source-backed resolution used the already sealed independent reference, created a new eval version, and applied the same suite to both unchanged arms. Wiring the planned resolver after that observation is explicitly a protocol implementation deviation; raw agreement was not unanimous. A later summary-variable error was recovered from durable completed-stage receipts without another model call.

The preregistered no-evidence forecast was borne out. These are five synthetic scalar requests, including only two holdouts; they do not establish utility on real refrigeration work or reliable unconstrained eval writing. See [machine decision](control/decision.json) and the independent audit for qualification limits.
''')
    print(json.dumps({'decision':choice,'developmentBothArms':len([x for x in pairs if x['stratum']=='development']),'holdoutBothArms':len([x for x in pairs if x['stratum']=='holdout']),'pairedDifferences':improvements,'resolutions':len(resolution['corrections'])}))

if __name__=='__main__':main()
