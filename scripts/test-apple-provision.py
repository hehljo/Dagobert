"""Offline healthy/defect cases for the real profile permission validator."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('apple_provision', Path(__file__).with_name('apple-provision.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# Minimal entitlement shape observed in the actual Apple-issued Dagobert profile.
HEALTHY = {'com.apple.developer.icloud-container-identifiers': ['iCloud.de.dagobert.app'],
           'com.apple.developer.icloud-services': '*',
           'com.apple.developer.icloud-container-environment': ['Production', 'Development'],
           'aps-environment': 'production'}


class ProfileCoverageTests(unittest.TestCase):
    def test_01_healthy(self):
        for services, environment in [('*', ['Production', 'Development']), (['CloudKit'], ['Production']),
                                      (['*'], ['Production']), ('*', 'Production')]:
            with self.subTest(services=services, environment=environment):
                profile = copy.deepcopy(HEALTHY)
                profile['com.apple.developer.icloud-services'] = services
                profile['com.apple.developer.icloud-container-environment'] = environment
                self.assertIs(module.capabilities_cover_app(profile), True)

    def test_02_single_defects(self):
        for key, value in [
            ('com.apple.developer.icloud-container-identifiers', []),
            ('com.apple.developer.icloud-container-identifiers', ['iCloud.other.app']),
            ('com.apple.developer.icloud-container-identifiers', 'iCloud.de.dagobert.app'),
            ('com.apple.developer.icloud-services', None),
            ('com.apple.developer.icloud-services', ['CloudDocuments']),
            ('com.apple.developer.icloud-services', 'OtherCloudKit'),
            ('com.apple.developer.icloud-services', ['OtherCloudKit']),
            ('com.apple.developer.icloud-container-environment', ['Development']),
            ('com.apple.developer.icloud-container-environment', None),
            ('com.apple.developer.icloud-container-environment', 'OtherProduction'),
            ('aps-environment', 'development')]:
            with self.subTest(key=key, value=value):
                profile = copy.deepcopy(HEALTHY); profile[key] = value
                self.assertIs(module.capabilities_cover_app(profile), False)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ProfileCoverageTests))
    print(json.dumps({'healthy_cases': 4, 'single_defect_cases': 11, 'failures': len(result.failures) + len(result.errors),
                      'scope': 'Offline profile permission coverage; no Apple API calls'}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
