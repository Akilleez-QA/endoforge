import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import durable


class DurableSyncTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / 'data'
        self.path.write_bytes(b'x')
        self.fd = os.open(self.path, os.O_RDWR)
        self.addCleanup(os.close, self.fd)

    def test_this_platform_uses_its_strongest_sync(self):
        expected = 'full_fsync' if durable.FULL_FSYNC is not None else 'fdatasync' if hasattr(os, 'fdatasync') else 'fsync'
        self.assertEqual(durable.sync_data(self.fd), expected)
        self.assertEqual(durable.sync_file(self.fd), 'full_fsync' if durable.FULL_FSYNC is not None else 'fsync')

    def test_without_full_fsync_data_sync_prefers_fdatasync_then_fsync(self):
        calls = []
        with mock.patch.object(durable, 'FULL_FSYNC', None), \
                mock.patch.object(os, 'fdatasync', lambda fd: calls.append('fdatasync'), create=True):
            self.assertEqual(durable.sync_data(self.fd), 'fdatasync')
        with mock.patch.object(durable, 'FULL_FSYNC', None), mock.patch.object(os, 'fdatasync', None, create=True):
            self.assertEqual(durable.sync_data(self.fd), 'fsync')
        self.assertEqual(calls, ['fdatasync'])

    def test_a_full_fsync_refused_by_the_file_system_falls_back_to_fsync(self):
        fake = mock.Mock()
        fake.fcntl.side_effect = OSError(45, 'not supported')
        calls = []
        with mock.patch.object(durable, 'FULL_FSYNC', 51), mock.patch.object(durable, 'fcntl', fake), \
                mock.patch.object(durable.os, 'fsync', lambda fd: calls.append(fd)):
            self.assertEqual(durable.sync_file(self.fd), 'fsync')
        self.assertEqual(calls, [self.fd])

    def test_directory_sync_is_skipped_where_directories_cannot_be_opened(self):
        with mock.patch.object(durable.sys, 'platform', 'win32'):
            self.assertEqual(durable.sync_dir(self.dir.name), 'skipped')
        self.assertNotEqual(durable.sync_dir(self.dir.name), 'skipped')

    def test_directory_sync_can_refuse_a_symlink(self):
        link = Path(self.dir.name) / 'link'
        link.symlink_to(self.dir.name)
        self.assertNotEqual(durable.sync_dir(link), 'skipped')
        with self.assertRaises(OSError):
            durable.sync_dir(link, nofollow=True)

    def test_an_error_from_the_sync_reaches_the_caller(self):
        with mock.patch.object(durable, 'FULL_FSYNC', None), \
                mock.patch.object(durable.os, 'fsync', side_effect=OSError(28, 'No space left on device')):
            with self.assertRaises(OSError):
                durable.sync_file(self.fd)


if __name__ == '__main__':
    unittest.main()
