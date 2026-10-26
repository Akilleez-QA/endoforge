"""memguard.plan on made-up machines: protection shares, big-job throttle, total budget hold, desktop untouched."""
import importlib.util, pathlib, unittest
SPEC = importlib.util.spec_from_file_location('memguard', pathlib.Path(__file__).resolve().parent.parent / 'memguard.py')
mg = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(mg)
GB = mg.GB


def unit(name, gb, exes=(), rel=None, high=None, low=0):
    return {'unit': name, 'rel': rel or f'app.slice/{name}', 'current': int(gb * GB), 'high': high, 'low': low, 'exes': list(exes)}


class Plan(unittest.TestCase):
    def acts(self, found, total_gb=124, slots=2):
        return {(u, tuple(sorted(p))): p for u, p, _ in mg.plan(found, total_gb * GB, slots)}

    def test_protects_claude_and_codex_on_their_main_scope(self):
        a = self.acts([unit('claude-main.scope', 6, ['claude', 'bash']), unit('claude-launch.scope', 0.6, ['claude-desktop']),
                       unit('chatgpt.scope', 1.5, ['ChatGPT', 'codex'])])
        self.assertEqual(a[('claude-main.scope', ('MemoryLow',))]['MemoryLow'], int(124 * GB * 0.12))
        self.assertEqual(a[('claude-launch.scope', ('MemoryLow',))]['MemoryLow'], GB)
        self.assertEqual(a[('chatgpt.scope', ('MemoryLow',))]['MemoryLow'], int(124 * GB * 0.06))

    def test_already_protected_is_left_alone(self):
        self.assertEqual(mg.plan([unit('c.scope', 2, ['claude'], low=int(124 * GB * 0.12))], 124 * GB, 2), [])

    def test_big_unprotected_job_gets_the_per_job_ceiling(self):
        a = self.acts([unit('kimodo.service', 15, ['python3.11'])])
        self.assertEqual(a[('kimodo.service', ('CPUWeight', 'MemoryHigh'))]['MemoryHigh'], int(124 * GB * 0.45 / 2))

    def test_small_jobs_and_the_desktop_are_never_throttled(self):
        found = [unit('small.service', 2, ['python']), unit('wm.service', 30, ['Hyprland'], rel='session.slice/wm.service'),
                 unit('job.scope', 30, ['blender'], rel='heavy.slice/job.scope')]
        self.assertEqual(mg.plan(found, 124 * GB, 2), [])

    def test_unprotected_total_over_budget_holds_the_largest(self):
        found = [unit('a.service', 25, ['blender']), unit('b.service', 22, ['python']), unit('c.service', 12, ['python'])]
        holds = [(u, p) for u, p, why in mg.plan(found, 124 * GB, 2) if why.startswith('hold')]
        self.assertEqual(holds, [('a.service', {'MemoryHigh': 25 * GB, 'CPUWeight': 40})])

    def test_scales_down_to_a_laptop(self):
        a = self.acts([unit('kimodo.service', 3, ['python'])], total_gb=16, slots=1)
        self.assertEqual(a[('kimodo.service', ('CPUWeight', 'MemoryHigh'))]['MemoryHigh'], int(16 * GB * 0.45))


if __name__ == '__main__':
    unittest.main()
