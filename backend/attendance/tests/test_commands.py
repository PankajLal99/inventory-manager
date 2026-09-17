"""Tests for ADMS device command queue (USERINFO register without biometrics)."""

from django.test import TestCase

from backend.attendance.models import Device, DeviceCommand, DeviceUserMapping
from backend.attendance.services.commands import (
    build_userinfo_delete,
    build_userinfo_update,
    next_pending_command,
    parse_devicecmd_body,
    sync_mapping_to_device,
)


DEVICE_SN = 'WED3253601172'


class UserInfoCommandFormatTests(TestCase):
    def test_update_has_empty_password_no_fingerprint(self):
        cmd = build_userinfo_update('2', 'ROHIT')
        self.assertTrue(cmd.startswith('DATA UPDATE USERINFO '))
        self.assertIn('PIN=2', cmd)
        self.assertIn('Name=ROHIT', cmd)
        self.assertIn('Password=', cmd)
        self.assertIn('Privilege=0', cmd)
        self.assertNotIn('TMP=', cmd)
        self.assertNotIn('FID=', cmd)

    def test_delete_format(self):
        self.assertEqual(build_userinfo_delete('2'), 'DATA DELETE USERINFO PIN=2')

    def test_wire_payload_prefix(self):
        device = Device.objects.create(
            serial_number=DEVICE_SN, status=Device.STATUS_ACTIVE, is_active=True
        )
        cmd = DeviceCommand.objects.create(
            device=device,
            command_text=build_userinfo_update('2', 'ROHIT'),
        )
        self.assertEqual(cmd.wire_payload(), f'C:{cmd.pk}:{cmd.command_text}')

    def test_parse_devicecmd_query_and_body(self):
        cid, code = parse_devicecmd_body('ID=42&Return=0', {'SN': DEVICE_SN})
        self.assertEqual(cid, 42)
        self.assertEqual(code, '0')

        cid2, code2 = parse_devicecmd_body('C:99:OK', {'ID': '99', 'Return': '0'})
        self.assertEqual(cid2, 99)
        self.assertEqual(code2, '0')


class CommandQueueDeliveryTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(
            serial_number=DEVICE_SN,
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )

    def test_getrequest_delivers_pending_command(self):
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        sync_mapping_to_device(mapping)
        self.assertEqual(DeviceCommand.objects.filter(status='PENDING').count(), 1)

        res = self.client.get('/iclock/getrequest', {'SN': DEVICE_SN})
        self.assertEqual(res.status_code, 200)
        body = res.content.decode()
        self.assertTrue(body.startswith('C:'))
        self.assertIn('DATA UPDATE USERINFO', body)
        self.assertIn('PIN=2', body)
        self.assertIn('Name=ROHIT', body)
        self.assertIn('Password=', body)

        cmd = DeviceCommand.objects.get()
        self.assertEqual(cmd.status, DeviceCommand.STATUS_SENT)

        res2 = self.client.get('/iclock/getrequest', {'SN': DEVICE_SN})
        self.assertEqual(res2.content.decode(), 'OK')

    def test_commands_delivered_fifo(self):
        DeviceCommand.objects.create(
            device=self.device,
            command_text=build_userinfo_update('1', 'A'),
            purpose='USERINFO_UPSERT',
            related_pin='1',
        )
        DeviceCommand.objects.create(
            device=self.device,
            command_text=build_userinfo_update('2', 'B'),
            purpose='USERINFO_UPSERT',
            related_pin='2',
        )
        first = self.client.get('/iclock/getrequest', {'SN': DEVICE_SN}).content.decode()
        second = self.client.get('/iclock/getrequest', {'SN': DEVICE_SN}).content.decode()
        self.assertIn('PIN=1', first)
        self.assertIn('PIN=2', second)

    def test_pin_change_queues_delete_then_update(self):
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()
        mapping.device_user_id = '5'
        mapping.save()
        cmds = sync_mapping_to_device(mapping, old_pin='2')
        self.assertEqual(len(cmds), 2)
        self.assertIn('DELETE', cmds[0].command_text)
        self.assertIn('PIN=2', cmds[0].command_text)
        self.assertIn('UPDATE', cmds[1].command_text)
        self.assertIn('PIN=5', cmds[1].command_text)

    def test_same_pin_only_upserts(self):
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()
        cmds = sync_mapping_to_device(mapping, old_pin='2')
        self.assertEqual(len(cmds), 1)
        self.assertIn('UPDATE', cmds[0].command_text)

    def test_inactive_mapping_queues_nothing(self):
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
            is_active=False,
        )
        DeviceCommand.objects.all().delete()
        self.assertEqual(sync_mapping_to_device(mapping), [])

    def test_devicecmd_acks_sent_command(self):
        cmd = DeviceCommand.objects.create(
            device=self.device,
            command_text='DATA UPDATE USERINFO PIN=1\tName=Test\tPrivilege=0\tPassword=\tCard=',
            purpose='USERINFO_UPSERT',
            related_pin='1',
        )
        delivered = next_pending_command(self.device)
        self.assertEqual(delivered.pk, cmd.pk)

        res = self.client.post(
            f'/iclock/devicecmd?SN={DEVICE_SN}&ID={cmd.pk}&Return=0',
            data=f'ID={cmd.pk}&Return=0',
            content_type='text/plain',
        )
        self.assertEqual(res.status_code, 200)
        cmd.refresh_from_db()
        self.assertEqual(cmd.status, DeviceCommand.STATUS_ACKED)
