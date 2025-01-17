# Generated by Django 2.2.3 on 2019-09-11 13:57

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('raidar', '0043_encounter_phases'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='encounterphase',
            name='enc_phase_unique',
        ),
        migrations.RemoveConstraint(
            model_name='encounterdamage',
            name='enc_dmg_unique',
        ),
        migrations.RemoveConstraint(
            model_name='encounterevent',
            name='enc_evt_unique',
        ),
        migrations.RemoveConstraint(
            model_name='encounterplayer',
            name='enc_player_unique',
        ),
        migrations.RemoveConstraint(
            model_name='encounterbuff',
            name='enc_buff_unique',
        ),
        migrations.RenameField(
            model_name='encounterbuff',
            old_name='encounter',
            new_name='encounter_data',
        ),
        migrations.RenameField(
            model_name='encounterdamage',
            old_name='encounter',
            new_name='encounter_data',
        ),
        migrations.RenameField(
            model_name='encounterevent',
            old_name='encounter',
            new_name='encounter_data',
        ),
        migrations.RenameField(
            model_name='encountermechanic',
            old_name='encounter',
            new_name='encounter_data',
        ),
        migrations.RenameField(
            model_name='encounterphase',
            old_name='encounter',
            new_name='encounter_data',
        ),
        migrations.RenameField(
            model_name='encounterplayer',
            old_name='encounter',
            new_name='encounter_data',
        ),
        migrations.RemoveField(
            model_name='encounterplayer',
            name='account_id',
        ),
        migrations.RemoveField(
            model_name='encounterplayer',
            name='death_tick',
        ),
        migrations.AddField(
            model_name='encounterplayer',
            name='account',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='raidar.Account'),
            preserve_default=False,
        ),
        migrations.AddConstraint(
            model_name='encounterphase',
            constraint=models.UniqueConstraint(fields=('encounter_data', 'name'), name='enc_phase_unique'),
        ),
        migrations.AddConstraint(
            model_name='encounterdamage',
            constraint=models.UniqueConstraint(fields=('encounter_data', 'phase', 'source', 'target', 'skill'), name='enc_dmg_unique'),
        ),
        migrations.AddConstraint(
            model_name='encounterevent',
            constraint=models.UniqueConstraint(fields=('encounter_data', 'phase', 'source'), name='enc_evt_unique'),
        ),
        migrations.AddConstraint(
            model_name='encounterplayer',
            constraint=models.UniqueConstraint(fields=('encounter_data', 'account'), name='enc_player_unique'),
        ),
        migrations.AddConstraint(
            model_name='encounterbuff',
            constraint=models.UniqueConstraint(fields=('encounter_data', 'phase', 'source', 'target', 'name'), name='enc_buff_unique'),
        ),
    ]
