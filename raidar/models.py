from django.db import models
from django.db.models.functions import Coalesce
from django.db.models.signals import post_save, post_delete
from django.db.models import UniqueConstraint, Sum, Avg
from django.contrib.auth.models import User
from django.core.validators import RegexValidator
from datetime import datetime, timedelta
import pytz
from fuzzycount import FuzzyCountManager
from hashlib import md5
from analyser.analyser import Profession, Archetype, Elite
from json import loads as json_loads, dumps as json_dumps
from gw2raidar import settings
from os.path import join as path_join
from functools import lru_cache
from time import time
from taggit.managers import TaggableManager
import random
import os
import re


# unique to 30-60s precision
START_RESOLUTION = 60



# XXX TODO Move to a separate module, does not really belong here
# gdrive_service = None
# if hasattr(settings, 'GOOGLE_CREDENTIAL_FILE'):
#     try:
#         from oauth2client.service_account import ServiceAccountCredentials
#         from httplib2 import Http
#         from apiclient import discovery
#         from googleapiclient.http import MediaFileUpload

#         scopes = ['https://www.googleapis.com/auth/drive.file']
#         credentials = ServiceAccountCredentials.from_json_keyfile_name(
#                 settings.GOOGLE_CREDENTIAL_FILE, scopes=scopes)
#         http_auth = credentials.authorize(Http())
#         gdrive_service = discovery.build('drive', 'v3', http=http_auth)
#     except ImportError:
#         # No Google Drive support
#         pass



User._meta.get_field('email')._unique = True



class ValueModel(models.Model):
    value = models.TextField(default="{}", editable=False)

    @property
    def val(self):
        return json_loads(self.value)

    @val.setter
    def val(self, value):
        self.value = json_dumps(value)

    class Meta:
        abstract = True




class UserProfile(models.Model):
    PRIVATE = 1
    SQUAD = 2
    PUBLIC = 3

    PRIVACY_CHOICES = (
            (PRIVATE, 'Private'),
            (SQUAD, 'Squad'),
            (PUBLIC, 'Public')
        )
    portrait_url = models.URLField(null=True, blank=True) # XXX not using... delete?
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="user_profile")
    last_notified_at = models.IntegerField(db_index=True, default=0, editable=False)
    privacy = models.PositiveSmallIntegerField(editable=False, choices=PRIVACY_CHOICES, default=SQUAD)

    def __str__(self):
        return self.user.username

def _create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

post_save.connect(_create_user_profile, sender=User)


def _safe_abs(value):
    try:
        return abs(value)
    except TypeError:
        return value


class Area(models.Model):
    id = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=64, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ('name',)


class Account(models.Model):
    ACCOUNT_NAME_RE = re.compile(r'\S+\.\d{4}') # TODO make more restrictive?
    API_KEY_RE = re.compile(
            r'-'.join(r'[0-9A-F]{%d}' % n for n in (8, 4, 4, 4, 20, 4, 4, 4, 12)) + r'$',
            re.IGNORECASE)

    user = models.ForeignKey(User, blank=True, null=True, on_delete=models.SET_NULL, related_name='accounts')
    name = models.CharField(max_length=64, unique=True, validators=[RegexValidator(ACCOUNT_NAME_RE)])
    api_key = models.CharField('API key', max_length=72, blank=True, validators=[RegexValidator(API_KEY_RE)])

    def __str__(self):
        return self.name

    class Meta:
        ordering = ('name',)


class Era(ValueModel):
    started_at = models.IntegerField(db_index=True)
    name = models.CharField(max_length=255)
    description = models.TextField()

    def __str__(self):
        return "%s (#%d)" % (self.name or "<unnamed>", self.id)

    @staticmethod
    def by_time(started_at):
        return Era.objects.filter(started_at__lte=started_at).latest('started_at')

    class Meta:
        ordering = ('-started_at',)


class Category(models.Model):
    name = models.CharField(max_length=255)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name_plural = "categories"


class Upload(ValueModel):
    filename = models.CharField(max_length=255)
    uploaded_at = models.IntegerField(db_index=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='unprocessed_uploads')

    def __str__(self):
        if self.uploaded_by:
            uploader = self.uploaded_by.username
        else:
            uploader = 'Unknown'
        return '%s (%s)' % (self.filename, uploader)

    def diskname(self):
        if hasattr(settings, 'UPLOAD_DIR'):
            upload_dir = settings.UPLOAD_DIR
        else:
            upload_dir = 'uploads'
        ext = '.' + '.'.join(self.filename.split('.')[1:])
        return path_join(upload_dir, str(self.id) + ext)

    class Meta:
        unique_together = ('filename', 'uploaded_by')

def _delete_upload_file(sender, instance, using, **kwargs):
    filename = instance.diskname()
    if filename:
        try:
            os.remove(filename)
        except FileNotFoundError:
            pass

post_delete.connect(_delete_upload_file, sender=Upload)


class Notification(ValueModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    created_at = models.IntegerField(db_index=True, default=time)


class Variable(ValueModel):
    key = models.CharField(max_length=255, primary_key=True)

    def __str__(self):
        return '%s=%s' % (self.key, self.val)

    def get(name):
        return Variable.objects.get(key=name).val

    def set(name, value):
        Variable.objects.update_or_create(key=name, defaults={'val': value})


@lru_cache(maxsize=1)
def _dictionary():
    location = os.path.realpath(os.path.join(os.getcwd(), os.path.dirname(__file__)))
    with open(os.path.join(location, "words.txt")) as f:
        return [l.strip() for l in f.readlines()]

def _generate_url_id(size=5):
    return ''.join(w.capitalize() for w in random.sample(_dictionary(), size))


def _safe_get_percent(key, data, fallback=0):
    return data[key] / 100.0 if key in data else fallback


def _generate_skill_data(encounter_data, phase_name, damage_source, damage_target, damage_data):
    for skill_name, skill_data in damage_data["Skill"].items():
        skill = EncounterDamage(encounter=encounter_data,
                                phase=phase_name,
                                source=damage_source,
                                target=damage_target,
                                skill=skill_name,
                                damage=skill_data["total"],
                                crit=_safe_get_percent("crit", skill_data),
                                fifty=_safe_get_percent("fifty", skill_data),
                                flanking=_safe_get_percent("flanking", skill_data),
                                scholar=_safe_get_percent("scholar", skill_data),
                                seaweed=_safe_get_percent("seaweed", skill_data))
        skill.save()


class EncounterData(models.Model):
    class Meta:
        db_table = "raidar_encounter_data"
    boss = models.TextField()
    cm = models.BooleanField()
    start_timestamp = models.DateTimeField()
    start_tick = models.PositiveIntegerField()
    end_tick = models.PositiveIntegerField()
    success = models.BooleanField()
    evtc_version = models.TextField()

    def duration_ticks(self):
        return self.end_tick - self.start_tick

    def duration(self):
        return self.duration_ticks() / 100

    @staticmethod
    def from_dump(dump):
        boss = "".join([boss_name for boss_name in dump["Category"]["boss"]["Boss"]])
        data = EncounterData(boss=boss,
                             cm=dump["Category"]["encounter"]["cm"],
                             start_timestamp=datetime.fromtimestamp(dump["Category"]["encounter"]["start"]),
                             start_tick=dump["Category"]["encounter"]["start_tick"],
                             end_tick=dump["Category"]["encounter"]["end_tick"],
                             success=dump["Category"]["encounter"]["success"],
                             evtc_version=dump["Category"]["encounter"]["evtc_version"])
        data.save()

        # Phases
        for phase_name, phase_data in dump["Category"]["encounter"]["Phase"].items():
            phase = EncounterPhase(encounter=data,
                                   name=phase_name,
                                   start_tick=phase_data["start_tick"])
            phase.save()

        # Players
        for player_name, player_data in dump["Category"]["status"]["Player"].items():
            player = EncounterPlayer(encounter=data,
                                     account_id=player_data["account"],
                                     character=player_name,
                                     party=player_data["party"],
                                     profession=player_data["profession"],
                                     elite=player_data["elite"],
                                     archetype=player_data["archetype"],
                                     conc=player_data["concentration"],
                                     condi=player_data["condition"],
                                     heal=player_data["healing"],
                                     tough=player_data["toughness"])
            player.save()

        for phase_name, phase_data in dump["Category"]["combat"]["Phase"].items():
            if phase_name == "All":
                continue

            for player_name, player_data in phase_data["Player"].items():
                player_data = player_data["Metrics"]

                # Buffs
                # Incoming
                for buff_source in player_data["buffs"]["From"]:
                    buff_target = player_name
                    for buff_name, buff_data in player_data["buffs"]["From"][buff_source].items():
                        if buff_data > 0:
                            buff = EncounterBuff(encounter=data,
                                                 phase=phase_name,
                                                 source=buff_source,
                                                 target=buff_target,
                                                 name=buff_name,
                                                 uptime=buff_data if buff_name in ["might", "stability"] else buff_data / 100.0)
                            buff.save()
                # Outgoing
                for buff_target in player_data["buffs"]["To"]:
                    buff_source = player_name
                    for buff_name, buff_data in player_data["buffs"]["To"][buff_target].items():
                        if buff_data > 0:
                            buff = EncounterBuff(encounter=data,
                                                 phase=phase_name,
                                                 source=buff_source,
                                                 target=buff_target,
                                                 name=buff_name,
                                                 uptime=buff_data if buff_name in ["might", "stability"] else buff_data / 100.0)
                            buff.save()

                # Damage
                # Incoming
                for damage_source, damage_data in player_data["damage"]["From"].items():
                    # Skill breakdown
                    if "Skill" in damage_data:
                        _generate_skill_data(data, phase_name, damage_source, player_name, damage_data)
                # Outgoing
                for damage_target, damage_data in player_data["damage"]["To"].items():
                    # Skill breakdown
                    if damage_target == "*All" and "Skill" in damage_data:
                        _generate_skill_data(data, phase_name, player_name, damage_target, damage_data)
                    # Summary
                    else:
                        # Condi
                        if damage_data["condi"] > 0:
                            condi = EncounterDamage(encounter=data,
                                                    phase=phase_name,
                                                    source=player_name,
                                                    target=damage_target,
                                                    skill="condi",
                                                    damage=damage_data["condi"],
                                                    crit=_safe_get_percent("crit", damage_data),
                                                    fifty=_safe_get_percent("fifty", damage_data),
                                                    flanking=_safe_get_percent("flanking", damage_data),
                                                    scholar=_safe_get_percent("scholar", damage_data),
                                                    seaweed=_safe_get_percent("seaweed", damage_data))
                            condi.save()
                        # Power
                        if damage_data["power"] > 0:
                            power = EncounterDamage(encounter=data,
                                                    phase=phase_name,
                                                    source=player_name,
                                                    target=damage_target,
                                                    skill="power",
                                                    damage=damage_data["power"],
                                                    crit=_safe_get_percent("crit", damage_data),
                                                    fifty=_safe_get_percent("fifty", damage_data),
                                                    flanking=_safe_get_percent("flanking", damage_data),
                                                    scholar=_safe_get_percent("scholar", damage_data),
                                                    seaweed=_safe_get_percent("seaweed", damage_data))
                            power.save()

                # Events
                event_data = player_data["events"]
                event = EncounterEvent(encounter=data,
                                       phase=phase_name,
                                       source=player_name,
                                       disconnect_count=event_data["disconnects"],
                                       disconnect_time=int(event_data["disconnect_time"]),
                                       down_count=event_data["downs"],
                                       down_time=int(event_data["down_time"]))
                event.save()

                # Shielded
                shield_data = player_data["shielded"]["From"]["*All"]
                shield = EncounterDamage(encounter=data,
                                         phase=phase_name,
                                         source="*All",
                                         target=player_name,
                                         skill="shielded",
                                         damage=-shield_data["total"],
                                         crit=_safe_get_percent("crit", shield_data),
                                         fifty=_safe_get_percent("fifty", shield_data),
                                         flanking=_safe_get_percent("flanking", shield_data),
                                         scholar=_safe_get_percent("scholar", shield_data),
                                         seaweed=_safe_get_percent("seaweed", shield_data))
                shield.save()

                # Mechanics
                if "mechanics" in player_data:
                    for mechanic_name, mechanic_data in player_data["mechanics"].items():
                        mechanic = EncounterMechanic(encounter=data,
                                                     phase=phase_name,
                                                     source=player_name,
                                                     name=mechanic_name,
                                                     count=mechanic_data)
                        mechanic.save()

        # TODO: Remove when fixed
        # If no mechanics were found within phases, they're probably only annotated in the "All" phase
        if not data.encountermechanic_set:
            for player_name, player_data in dump["Category"]["combat"]["Phase"]["All"]["Player"].items():
                if "mechanics" in player_data:
                    for mechanic_name, mechanic_data in player_data["mechanics"].items():
                        mechanic = EncounterMechanic(encounter=data,
                                                     phase="All",
                                                     source=player_name,
                                                     name=mechanic_name,
                                                     count=mechanic_data)
        return data


class Encounter(models.Model):
    encounter_data = models.ForeignKey(EncounterData, db_column="encounter_data_id", on_delete=models.CASCADE)
    url_id = models.TextField(max_length=255, editable=False, unique=True, default=_generate_url_id, verbose_name="URL ID")
    started_at = models.IntegerField(db_index=True)
    duration = models.FloatField()
    success = models.BooleanField()
    filename = models.CharField(max_length=255)
    uploaded_at = models.IntegerField(db_index=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='uploaded_encounters')
    area = models.ForeignKey(Area, on_delete=models.PROTECT, related_name='encounters')
    era = models.ForeignKey(Era, on_delete=models.PROTECT, related_name='encounters')
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, related_name='encounters', null=True, blank=True)
    accounts = models.ManyToManyField(Account, through='Participation', related_name='encounters')
    # hack to try to ensure uniqueness
    account_hash = models.CharField(max_length=32, editable=False)
    started_at_full = models.IntegerField(editable=False)
    started_at_half = models.IntegerField(editable=False)
    # Google Drive
    gdrive_id = models.CharField(max_length=255, editable=False, null=True, blank=True)
    gdrive_url = models.CharField(max_length=255, editable=False, null=True, blank=True)
    tags = TaggableManager(blank=True)
    has_evtc = models.BooleanField(default=True, editable=False)

    objects = FuzzyCountManager()

    def __str__(self):
        if self.uploaded_by:
            uploader = self.uploaded_by.username
        else:
            uploader = 'Unknown'
        return '%s (%s, %s, #%s)' % (self.area.name, self.filename, uploader, self.id)

    # Returns timestamp of closest non-future raid reset (Monday 08:30 UTC)
    @staticmethod
    def week_for(started_at):
        encounter_dt = datetime.utcfromtimestamp(started_at).replace(tzinfo=pytz.UTC)
        reset_dt = (encounter_dt - timedelta(days=encounter_dt.weekday())).replace(hour=7, minute=30, second=0, microsecond=0)
        if reset_dt > encounter_dt:
            reset_dt -= timedelta(weeks=1)
        return int(reset_dt.timestamp())

    def week(self):
        return Encounter.week_for(self.started_at)

    def save(self, *args, **kwargs):
        self.started_at_full, self.started_at_half = Encounter.calculate_start_guards(self.started_at)
        super(Encounter, self).save(*args, **kwargs)

    def diskname(self):
        if not self.uploaded_by:
            return None
        if hasattr(settings, 'UPLOAD_DIR'):
            upload_dir = settings.UPLOAD_DIR
        else:
            upload_dir = 'uploads'
        return path_join(upload_dir, 'encounters', self.uploaded_by.username, self.filename)

    def update_has_evtc(self):
        self.has_evtc = os.path.isfile(self.diskname())
        self.save()

    @property
    def tagstring(self):
        return ','.join(self.tags.names())

    @tagstring.setter
    def tagstring(self, value):
        self.tags.set(*value.split(','))

    @staticmethod
    def calculate_account_hash(account_names):
        conc = ':'.join(sorted(account_names))
        hash_object = md5(conc.encode())
        return hash_object.hexdigest()

    @staticmethod
    def calculate_start_guards(started_at):
        started_at_full = round(started_at / START_RESOLUTION) * START_RESOLUTION
        started_at_half = round((started_at + START_RESOLUTION / 2) / START_RESOLUTION) * START_RESOLUTION
        return (started_at_full, started_at_half)


    class Meta:
        index_together = ('area', 'started_at')
        ordering = ('started_at',)
        unique_together = (
            ('area', 'account_hash', 'started_at_full'),
            ('area', 'account_hash', 'started_at_half'),
        )

def _delete_encounter_file(sender, instance, using, **kwargs):
    # if gdrive_service and instance.gdrive_id:
    #     gdrive_service.files().delete(
    #             fileId=instance.gdrive_id).execute()
    filename = instance.diskname()
    if filename:
        try:
            os.remove(filename)
        except FileNotFoundError:
            pass

post_delete.connect(_delete_encounter_file, sender=Encounter)


class Participation(models.Model):
    PROFESSION_CHOICES = (
            (int(Profession.GUARDIAN), 'Guardian'),
            (int(Profession.WARRIOR), 'Warrior'),
            (int(Profession.ENGINEER), 'Engineer'),
            (int(Profession.RANGER), 'Ranger'),
            (int(Profession.THIEF), 'Thief'),
            (int(Profession.ELEMENTALIST), 'Elementalist'),
            (int(Profession.MESMER), 'Mesmer'),
            (int(Profession.NECROMANCER), 'Necromancer'),
            (int(Profession.REVENANT), 'Revenant'),
        )

    ARCHETYPE_CHOICES = (
            (int(Archetype.POWER), "Power"),
            (int(Archetype.CONDI), "Condi"),
            (int(Archetype.TANK), "Tank"),
            (int(Archetype.HEAL), "Heal"),
            (int(Archetype.SUPPORT), "Support"),
        )

    ELITE_CHOICES = (
            (int(Elite.CORE), "Core"),
            (int(Elite.HEART_OF_THORNS), "Heart of Thorns"),
            (int(Elite.PATH_OF_FIRE), "Path of Fire"),
        )

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name='participations')
    character = models.CharField(max_length=64, db_index=True)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='participations')
    profession = models.PositiveSmallIntegerField(choices=PROFESSION_CHOICES, db_index=True)
    archetype = models.PositiveSmallIntegerField(choices=ARCHETYPE_CHOICES, db_index=True)
    elite = models.PositiveSmallIntegerField(choices=ELITE_CHOICES, db_index=True)
    party = models.PositiveSmallIntegerField(db_index=True)

    def __str__(self):
        return '%s (%s) in %s' % (self.character, self.account.name, self.encounter)

    def data(self):
        return {
                'id': self.encounter.id,
                'url_id': self.encounter.url_id,
                'area': self.encounter.area.name,
                'started_at': self.encounter.started_at,
                'duration': self.encounter.duration,
                'character': self.character,
                'account': self.account.name,
                'profession': self.profession,
                'archetype': self.archetype,
                'elite': self.elite,
                'uploaded_at': self.encounter.uploaded_at,
                'success': self.encounter.success,
                'category': self.encounter.category_id,
                #'tags': list(self.encounter.tags.names()),
                'tags': [t.tag.name for t in self.encounter.tagged_items.all()],
            }

    class Meta:
        unique_together = ('encounter', 'account')


class EraAreaStore(ValueModel):
    era = models.ForeignKey(Era, on_delete=models.CASCADE, related_name="era_area_stores")
    area = models.ForeignKey(Area, on_delete=models.CASCADE, related_name="era_area_stores")
    leaderboards_value = models.TextField(default="{}", editable=False)

    @property
    def leaderboards(self):
        return json_loads(self.leaderboards_value)

    @leaderboards.setter
    def leaderboards(self, value):
        self.leaderboards_value = json_dumps(value)


class EraUserStore(ValueModel):
    era = models.ForeignKey(Era, on_delete=models.CASCADE, related_name="era_user_stores")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="era_user_stores")

class RestatPerfStats(models.Model):
    started_on = models.DateTimeField()
    ended_on = models.DateTimeField()
    number_users = models.IntegerField()
    number_eras = models.IntegerField()
    number_areas = models.IntegerField()
    number_new_encounters = models.IntegerField()
    was_force = models.BooleanField()


class EncounterAttribute(models.Model):
    class Meta:
        abstract = True
    encounter = models.ForeignKey(EncounterData, db_column="encounter_data_id", on_delete=models.CASCADE)


class SourcedEncounterAttribute(EncounterAttribute):
    class Meta:
        abstract = True
        constraints = [UniqueConstraint(fields=["encounter", "phase", "source"], name="enc_attr_unique")]
    phase = models.TextField()
    source = models.TextField()


class TargetedEncounterAttribute(SourcedEncounterAttribute):
    class Meta:
        abstract = True
        constraints = [UniqueConstraint(fields=["encounter", "phase", "source", "target"], name="enc_target_attr_unique")]
    target = models.TextField()


class NamedSourcedEncounterAttribute(SourcedEncounterAttribute):
    class Meta:
        abstract = True
        constraints = [UniqueConstraint(fields=["encounter", "phase", "source", "name"], name="enc_name_attr_unique")]
    name = models.TextField()


class EncounterEvent(SourcedEncounterAttribute):
    class Meta:
        db_table = "raidar_encounter_event"
        constraints = [UniqueConstraint(fields=["encounter", "phase", "source"], name="enc_evt_unique")]
    disconnect_count = models.PositiveIntegerField()
    disconnect_time = models.PositiveIntegerField()
    down_count = models.PositiveIntegerField()
    down_time = models.PositiveIntegerField()
    dead_count = models.PositiveIntegerField()
    dead_time = models.PositiveIntegerField()

    def get_inactive_time(self):
        return self.disconnect_time + self.down_time + self.dead_time

    @staticmethod
    def summarize(query):
        return query.aggregate(disconnect_count=Sum("disconnect_count"),
                               disconnect_time=Sum("disconnect_time"),
                               down_count=Sum("down_count"),
                               down_time=Sum("down_time"),
                               dead_count=Sum("dead_time"),
                               dead_time=Sum("dead_count"))


class EncounterMechanic(NamedSourcedEncounterAttribute):
    class Meta:
        db_table = "raidar_encounter_mechanic"
    count = models.PositiveIntegerField()


class EncounterBuff(TargetedEncounterAttribute):
    class Meta:
        db_table = "raidar_encounter_buff"
        constraints = [UniqueConstraint(fields=["encounter", "phase", "source", "target", "name"], name="enc_buff_unique")]
    name = models.TextField()
    uptime = models.FloatField()


class EncounterDamage(TargetedEncounterAttribute):
    class Meta:
        db_table = "raidar_encounter_damage"
        constraints = [UniqueConstraint(fields=["encounter", "phase", "source", "target", "skill"], name="enc_dmg_unique")]
    skill = models.TextField()
    damage = models.IntegerField()
    crit = models.FloatField()
    fifty = models.FloatField()
    flanking = models.FloatField()
    scholar = models.FloatField()
    seaweed = models.FloatField()

    def data(self):
        return {
            "skill": self.skill,
            "total": self.damage,
            "crit": self.crit * 100.0,
            "fifty": self.fifty * 100.0,
            "flanking": self.flanking * 100.0,
            "scholar": self.scholar * 100.0,
            "seaweed": self.seaweed * 100.0,
        }

    @staticmethod
    def summarize(query, target, absolute=False):
        prv_sum = query.filter(skill=target)
        prv_query = prv_sum if prv_sum.count() > 0 else\
            query.filter(skill__in=EncounterDamage.conditions()) if target == "condi" else\
            query.exclude(skill__in=EncounterDamage.conditions())
        data = prv_query.aggregate(total=Coalesce(Sum("damage"), 0),  # TODO: This solution for calculating average stats is imprecise!
                                   crit=Coalesce(Avg("crit") * 100.0, 0),
                                   fifty=Coalesce(Avg("fifty") * 100.0, 0),
                                   flanking=Coalesce(Avg("flanking") * 100.0, 0),
                                   scholar=Coalesce(Avg("scholar") * 100.0, 0),
                                   seaweed=Coalesce(Avg("seaweed") * 100.0, 0))
        if absolute:
            data = {key: _safe_abs(val) for key, val in data.items()}
        return data

    @staticmethod
    def conditions():
        return ["Bleeding", "Burning", "Confusion", "Poisoned", "Torment"]


class EncounterPlayer(EncounterAttribute):
    class Meta:
        db_table = "raidar_encounter_player"
        constraints = [UniqueConstraint(fields=["encounter", "account_id"], name="enc_player_unique")]
    account_id = models.TextField()
    character = models.TextField()
    party = models.PositiveIntegerField()
    profession = models.PositiveIntegerField()
    elite = models.PositiveIntegerField()
    archetype = models.PositiveIntegerField()
    conc = models.PositiveIntegerField()
    condi = models.PositiveIntegerField()
    heal = models.PositiveIntegerField()
    tough = models.PositiveIntegerField()
    death_tick = models.PositiveIntegerField(null=True)

    def data(self):
        return {
            "name": self.character,
            "account": self.account_id,
            "profession": self.profession,
            "elite": self.elite,
            "archetype": self.archetype,
            "concentration": self.conc,
            "condition": self.condi,
            "healing": self.heal,
            "toughness": self.tough,
            "Death": self.death_tick,
        }


class EncounterPhase(EncounterAttribute):
    class Meta:
        db_table = "raidar_encounter_phase"
        constraints = [UniqueConstraint(fields=["encounter", "name"], name="enc_phase_unique")]
    name = models.TextField()
    start_tick = models.PositiveIntegerField()
