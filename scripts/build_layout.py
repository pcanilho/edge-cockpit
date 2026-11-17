"""Build layouts/star-citizen.json from Star Citizen's defaultProfile.xml.

Usage: python scripts/build_layout.py path/to/defaultProfile.xml > layouts/star-citizen.json

Every action name is checked against the profile, and each key records the
default keyboard bind, so a layout never points at an action that doesn't exist.
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

COLUMNS, ROWS = 8, 4

# ---------------------------------------------------------------------------
# Every key the deck can show: label -> (action, press, glyph). press is tap,
# hold or danger. Pages below refer to keys by label.
# ---------------------------------------------------------------------------
CATALOG = {
    'Flight ready': ('v_flightready', 'tap', 'ready'),
    'Power': ('v_power_toggle', 'tap', 'power'),
    'Thrusters': ('v_power_toggle_thrusters', 'tap', 'flame'),
    'Shields': ('v_power_toggle_shields', 'tap', 'shield'),
    'Weapons': ('v_power_toggle_weapons', 'tap', 'crosshair'),
    'Lights': ('v_lights', 'tap', 'bulb'),
    'Doors': ('v_toggle_all_doors', 'tap', 'door'),
    'Open doors': ('v_open_all_doors', 'tap', 'door'),
    'Close doors': ('v_close_all_doors', 'tap', 'door'),
    'Chat window': ('toggle_chat', 'tap', 'chat'),
    'Power on': ('v_power_set_on', 'tap', 'power'),
    'Power off': ('v_power_set_off', 'tap', 'power'),
    'Thrusters on': ('v_power_set_thrusters_on', 'tap', 'flame'),
    'Thrusters off': ('v_power_set_thrusters_off', 'tap', 'flame'),
    'Shields on': ('v_power_set_shields_on', 'tap', 'shield'),
    'Shields off': ('v_power_set_shields_off', 'tap', 'shield'),
    'Weapons on': ('v_power_set_weapons_on', 'tap', 'crosshair'),
    'Weapons off': ('v_power_set_weapons_off', 'tap', 'crosshair'),
    'Lights on': ('v_lights_on', 'tap', 'bulb'),
    'Lights off': ('v_lights_off', 'tap', 'bulb'),
    'VTOL on': ('v_vtol_on', 'tap', 'vtol'),
    'VTOL off': ('v_vtol_off', 'tap', 'vtol'),
    'Speed limiter on': ('v_ifcs_speed_limiter_on', 'tap', 'limiter'),
    'Speed limiter off': ('v_ifcs_speed_limiter_off', 'tap', 'limiter'),
    'Decoupled on': ('v_ifcs_vector_decoupling_on', 'tap', 'split'),
    'Decoupled off': ('v_ifcs_vector_decoupling_off', 'tap', 'split'),
    'G-safe on': ('v_ifcs_gsafe_on', 'tap', 'person'),
    'G-safe off': ('v_ifcs_gsafe_off', 'tap', 'person'),
    'Proximity assist on': ('v_ifcs_proximity_assist_on', 'tap', 'proximity'),
    'Proximity assist off': ('v_ifcs_proximity_assist_off', 'tap', 'proximity'),
    'Advanced HUD on': ('v_flight_advanced_hud_on', 'tap', 'layers'),
    'Advanced HUD off': ('v_flight_advanced_hud_off', 'tap', 'layers'),
    'Stability on': ('v_ifcs_stability_on', 'tap', 'assist'),
    'Stability off': ('v_ifcs_stability_off', 'tap', 'assist'),
    'Gravity comp on': ('v_ifcs_gravity_compensation_on', 'tap', 'gauge'),
    'Gravity comp off': ('v_ifcs_gravity_compensation_off', 'tap', 'gauge'),
    'Staggered fire on': ('v_weapon_staggered_fire_on', 'tap', 'guns'),
    'Staggered fire off': ('v_weapon_staggered_fire_off', 'tap', 'guns'),
    'Set NAV': ('v_master_mode_set_nav', 'tap', 'gauge'),
    'Set SCM': ('v_master_mode_set_scm', 'tap', 'gauge'),
    'Panic decoy': ('v_weapon_countermeasure_decoy_launch_panic', 'tap', 'flare'),
    'Hail target': ('v_target_hail', 'tap', 'chat'),
    'Push to talk': ('foip_pushtotalk', 'hold', 'chat'),
    'Landing gear': ('v_toggle_landing_system', 'tap', 'gear'),
    'Autoland': ('v_autoland', 'hold', 'land'),
    'VTOL': ('v_vtol_toggle', 'tap', 'vtol'),
    'ATC request': ('v_atc_request', 'tap', 'tower'),
    'Docking request': ('v_toggle_docking_request', 'tap', 'dock'),
    'Loading area': ('v_atc_loading_area_request', 'tap', 'crate'),
    'NAV / SCM': ('v_master_mode_cycle_long', 'hold', 'gauge'),
    'Decoupled': ('v_ifcs_vector_decoupling_toggle', 'tap', 'split'),
    'Cruise throttle': ('v_ifcs_throttle_swap_mode', 'tap', 'cruise'),
    'Speed limiter': ('v_ifcs_speed_limiter_toggle', 'tap', 'limiter'),
    'G-safe': ('v_ifcs_toggle_gforce_safety', 'tap', 'person'),
    'ESP': ('v_ifcs_toggle_esp', 'tap', 'assist'),
    'Proximity assist': ('v_ifcs_proximity_assist_toggle', 'tap', 'proximity'),
    'Space brake': ('v_space_brake', 'hold', 'stop'),
    'Lock rotation': ('v_lock_rotation', 'tap', 'rotlock'),
    'Quantum': ('v_toggle_qdrive_engagement', 'hold', 'quantum'),
    'Scan mode': ('v_toggle_scan_mode', 'tap', 'radar'),
    'Ping': ('v_invoke_ping', 'hold', 'ping'),
    'Look behind': ('v_view_look_behind', 'hold', 'lookback'),
    'Freelook': ('v_view_freelook_mode', 'hold', 'eye'),
    'Starmap': ('v_starmap', 'tap', 'compass'),
    'Eject': ('v_eject', 'danger', 'eject'),
    'Lock 1': ('v_target_toggle_lock_index_1', 'tap', 'target'),
    'Lock 2': ('v_target_toggle_lock_index_2', 'tap', 'target'),
    'Lock 3': ('v_target_toggle_lock_index_3', 'tap', 'target'),
    'Unlock': ('v_target_unlock', 'tap', 'untarget'),
    'Clear pins': ('v_target_remove_all_pins', 'tap', 'unpin'),
    'Auto target': ('v_auto_targeting_toggle_long', 'hold', 'autotarget'),
    'Look ahead': ('v_look_ahead_enable', 'tap', 'lookahead'),
    'Gimbal mode': ('v_weapon_gimbals_state_toggle', 'tap', 'gimbal'),
    'Gimbals locked': ('v_weapon_gimbals_state_set_locked', 'tap', 'gimbal-lock'),
    'Gimbals free': ('v_weapon_gimbals_state_set_unlocked', 'tap', 'gimbal'),
    'Aim mode': ('v_weapon_aim_type_cycle', 'tap', 'aim'),
    'Guns group 1': ('v_weapon_preset_guns0', 'tap', 'guns'),
    'Guns group 2': ('v_weapon_preset_guns1', 'tap', 'guns'),
    'Guns group 3': ('v_weapon_preset_guns2', 'tap', 'guns'),
    'Decoy': ('v_weapon_countermeasure_decoy_launch', 'tap', 'flare'),
    'Noise': ('v_weapon_countermeasure_noise_launch', 'tap', 'noise'),
    'Decoy burst +': ('v_weapon_countermeasure_decoy_burst_increase', 'tap', 'flare'),
    'Decoy burst −': ('v_weapon_countermeasure_decoy_burst_decrease', 'tap', 'flare'),
    'Missiles +': ('v_weapon_increase_max_missiles', 'tap', 'missile'),
    'Missiles reset': ('v_weapon_reset_max_missiles', 'tap', 'missile'),
    'Guns group 4': ('v_weapon_preset_guns3', 'tap', 'guns'),
    'EMP': ('v_weapon_preset_emp', 'tap', 'bolt'),
    'QED': ('v_weapon_preset_qid', 'tap', 'quantum'),
    'QED pulse': ('v_weapon_preset_qid_pulse', 'tap', 'quantum'),
    'QED jammer': ('v_weapon_preset_qid_jammer', 'tap', 'quantum'),
    'Stagger fire': ('v_weapon_staggered_fire_toggle', 'tap', 'stagger'),
    'Shields +': ('v_engineering_assignment_shields_increase', 'tap', 'shield'),
    'Weapons +': ('v_engineering_assignment_weapons_increase', 'tap', 'crosshair'),
    'Engines +': ('v_engineering_assignment_engine_increase', 'tap', 'flame'),
    'Throttle +': ('v_power_throttle_up', 'tap', 'bars'),
    'Throttle −': ('v_power_throttle_down', 'tap', 'bars'),
    'Power reset': ('v_engineering_assignment_reset', 'tap', 'reset'),
    'Shields −': ('v_engineering_assignment_shields_decrease', 'tap', 'shield'),
    'Shields max': ('v_engineering_assignment_shields_max', 'hold', 'shield'),
    'Shields min': ('v_engineering_assignment_shields_min', 'hold', 'shield'),
    'Throttle max': ('v_power_throttle_max', 'tap', 'bars'),
    'Throttle min': ('v_power_throttle_min', 'tap', 'bars'),
    'Weapons −': ('v_engineering_assignment_weapons_decrease', 'tap', 'crosshair'),
    'Weapons max': ('v_engineering_assignment_weapons_max', 'hold', 'crosshair'),
    'Weapons min': ('v_engineering_assignment_weapons_min', 'hold', 'crosshair'),
    'Door locks': ('v_toggle_all_doorlocks', 'tap', 'lock'),
    'Engines −': ('v_engineering_assignment_engine_decrease', 'tap', 'flame'),
    'Engines max': ('v_engineering_assignment_engine_max', 'hold', 'flame'),
    'Engines min': ('v_engineering_assignment_engine_min', 'hold', 'flame'),
    'Port locks': ('v_toggle_all_portlocks', 'tap', 'lock'),
    'Self destruct': ('v_self_destruct', 'danger', 'blast'),
    'Mining mode': ('v_toggle_mining_mode', 'tap', 'pickaxe'),
    'Laser type': ('v_toggle_mining_laser_type', 'tap', 'laser'),
    'Module 1': ('v_mining_use_consumable1', 'tap', 'chip'),
    'Module 2': ('v_mining_use_consumable2', 'tap', 'chip'),
    'Module 3': ('v_mining_use_consumable3', 'tap', 'chip'),
    'Perm. module': ('v_mining_use_permanent_modifier', 'tap', 'chip'),
    'Jettison cargo': ('v_jettison_volatile_cargo', 'danger', 'jettison'),
    'Salvage mode': ('v_toggle_salvage_mode', 'tap', 'claw'),
    'Fire left': ('v_salvage_toggle_fire_left', 'tap', 'beam-left'),
    'Fire right': ('v_salvage_toggle_fire_right', 'tap', 'beam-right'),
    'Fracture': ('v_salvage_toggle_fire_fracture', 'tap', 'fracture'),
    'Disintegrate': ('v_salvage_toggle_fire_disintegrate', 'tap', 'scatter'),
    'Head gimbal': ('v_salvage_toggle_gimbal_mode', 'tap', 'gimbal'),
    'Reset gimbal': ('v_salvage_reset_gimbal', 'tap', 'reset'),
    'Focus all': ('v_salvage_focus_all_heads', 'tap', 'focus'),
    'Focus left': ('v_salvage_focus_left', 'tap', 'focus'),
    'Focus right': ('v_salvage_focus_right', 'tap', 'focus'),
    'Focus fracture': ('v_salvage_focus_fracture', 'tap', 'focus'),
    'Beam axis': ('v_salvage_toggle_beam_spacing_axis', 'tap', 'axis'),
    'Refuel mode': ('v_toggle_refuel_mode', 'tap', 'fuel'),
    'Operator mode': ('v_operator_mode_cycle_forward', 'tap', 'cog'),
    'Primary': ('select_primary_pit', 'tap', 'rifle'),
    'Secondary': ('select_secondary_pit', 'tap', 'rifle'),
    'Sidearm': ('select_sidearm_pit', 'tap', 'pistol'),
    'Melee': ('select_meleeweapon_pit', 'tap', 'knife'),
    'Gadget': ('select_gadget_pit', 'tap', 'grenade'),
    'Unarmed': ('selectUnarmedCombat', 'tap', 'hand'),
    'Reload': ('reload', 'tap', 'reload'),
    'Lower weapon': ('toggle_lowered', 'tap', 'lower'),
    'Flashlight': ('toggle_flashlight', 'tap', 'torch'),
    'Helmet on/off': ('toggleEquipHelmet', 'tap', 'helmet'),
    'Helmet attach': ('toggleAttachHelmet', 'tap', 'helmet'),
    'Visor wipe': ('visor_wipe', 'tap', 'wiper'),
    'Third person': ('thirdperson', 'tap', 'person'),
    'Free camera': ('free_thirdperson_camera', 'hold', 'camera'),
    'Crouch': ('crouch', 'tap', 'crouch'),
    'Prone': ('prone', 'tap', 'prone'),
    'mobiGlas': ('mobiglas', 'tap', 'wrist'),
    'Consume': ('consume', 'hold', 'cup'),
    'Heal target': ('combathealtarget', 'hold', 'medical'),
    'Tractor detach': ('tractor_beam_detach', 'tap', 'magnet'),
    'Tractor rotate': ('tractor_beam_rotate', 'hold', 'rotate'),
    'Beam closer': ('tractor_beam_decrease_distance', 'tap', 'pull'),
    'Beam farther': ('tractor_beam_increase_distance', 'tap', 'push'),
    'Walk': ('walk', 'tap', 'person'),
    'Stabilize': ('stabilize', 'hold', 'hand'),
    'Revive request': ('downedRevivalRequest', 'hold', 'pulse'),
    'Give up': ('incapacitatedRespawn', 'hold', 'back'),
    # Emotes and hand signals (player_emotes); only the signals have default keys.
    'Signal forward': ('emote_cs_forward', 'tap', 'up'),
    'Signal left': ('emote_cs_left', 'tap', 'left'),
    'Signal right': ('emote_cs_right', 'tap', 'right'),
    'Signal stop': ('emote_cs_stop', 'tap', 'stop'),
    'Signal yes': ('emote_cs_yes', 'tap', 'person'),
    'Signal no': ('emote_cs_no', 'tap', 'x'),
    'Wave': ('emote_wave', 'tap', 'hand'),
    'Salute': ('emote_salute', 'tap', 'hand'),
    'Point': ('emote_point', 'tap', 'right'),
    'Come': ('emote_come', 'tap', 'pull'),
    'Wait': ('emote_wait', 'tap', 'hand'),
    'Agree': ('emote_agree', 'tap', 'person'),
    'Disagree': ('emote_disagree', 'tap', 'person'),
    'Cheer': ('emote_cheer', 'tap', 'person'),
    'Clap': ('emote_clap', 'tap', 'person'),
    'Laugh': ('emote_laugh', 'tap', 'person'),
    'Dance': ('emote_dance', 'tap', 'person'),
    'Bow': ('emote_bow', 'tap', 'person'),
    'Greet': ('emote_greet', 'tap', 'person'),
    'Threaten': ('emote_threaten', 'tap', 'person'),
    'Taunt': ('emote_taunt', 'tap', 'person'),
    'Rude': ('emote_rude', 'tap', 'person'),
    'Sit': ('emote_sit', 'tap', 'crouch'),
    'Sleep': ('emote_sleep', 'tap', 'moon'),
    'Flex': ('emote_flex', 'tap', 'person'),
    'Gloat': ('emote_gloat', 'tap', 'person'),
    'Angry': ('emote_angry', 'tap', 'person'),
    'At ease': ('emote_atease', 'tap', 'person'),
    'Attention': ('emote_attention', 'tap', 'person'),
    'Whistle': ('emote_whistle', 'tap', 'person'),
    'Local map': ('mapui_action_goto_localmap', 'tap', 'map'),
    'My location': ('mapui_action_mylocation', 'tap', 'locate'),
    'Go to selection': ('mapui_action_goto_selection', 'tap', 'pin'),
    'Step back': ('mapui_action_step_back', 'tap', 'back'),
    'Plan route': ('mapui_action_planroute', 'tap', 'route'),
    'Clear route': ('mapui_action_clearroute', 'tap', 'x'),
    'Toggle pin': ('mapui_action_togglepin', 'tap', 'pin'),
    'Whole zone': ('mapui_action_toggle_view_entire_zone', 'tap', 'focus'),
    'Section ◀': ('mapui_cycle_section_backward', 'tap', 'left'),
    'Section ▶': ('mapui_cycle_section_forward', 'tap', 'right'),
    'Zone ◀': ('mapui_cycle_zone_backward', 'tap', 'left'),
    'Zone ▶': ('mapui_cycle_zone_forward', 'tap', 'right'),
    'QT actions': ('mapui_action_toggleQTActions', 'hold', 'quantum'),
    'Reply 1': ('pc_conversation_option1', 'tap', 'chat'),
    'Reply 2': ('pc_conversation_option2', 'tap', 'chat'),
    'Reply 3': ('pc_conversation_option3', 'tap', 'chat'),
    'Reply 4': ('pc_conversation_option4', 'tap', 'chat'),
    'Reply 5': ('pc_conversation_option5', 'tap', 'chat'),
    'Scoreboard': ('v_hud_open_scoreboard', 'hold', 'list'),
    'Advanced HUD': ('v_flight_advanced_hud_toggle', 'tap', 'layers'),
    'Scan tab ◀': ('v_ui_prev_scan_tab', 'tap', 'left'),
    'Scan tab ▶': ('v_ui_next_scan_tab', 'tap', 'right'),
    'Contact ▲': ('v_ui_prev_contact', 'tap', 'up'),
    'Contact ▼': ('v_ui_next_contact', 'tap', 'down'),
    'MFD ▶': ('v_mfd_interact_cycle_forwards_short', 'tap', 'right'),
    'MFD ◀': ('v_mfd_interact_cycle_backwards_short', 'tap', 'left'),
}

# ---------------------------------------------------------------------------
# Pages are 8 keys wide. The top row
# is the page rail and the bottom row is the same on every page, so your hands
# learn where they are: flight keys on the left, panic keys on the right. Each
# page fills the two rows between, as two labelled panels of eight keys.
# ---------------------------------------------------------------------------
FLIGHT_ROW = ['Flight ready', 'Landing gear', 'Quantum', 'Decoupled']
PANIC = ['Space brake', 'Decoy', 'Noise', 'Eject']
FIXED_GROUPS = [('Flight', 2, 0, 4, 1), ('Panic', 2, 4, 4, 1)]

PAGES = {
    'flight': [
        ('Systems', ['Power', 'Thrusters', 'Shields', 'Weapons', 'Lights', 'Doors', 'VTOL', 'Startup']),
        ('Landing & assists', ['Autoland', 'ATC request', 'Loading area', 'NAV / SCM', 'Cruise throttle', 'Speed limiter', 'Lock rotation', 'Scan mode']),
    ],
    'combat': [
        ('Targeting', ['Lock 1', 'Lock 2', 'Lock 3', 'Unlock', 'Auto target', 'Look ahead', 'Ping', 'Combat prep']),
        ('Weapons', ['Gimbal mode', 'Gimbals locked', 'Gimbals free', 'Guns group 1', 'Guns group 2', 'Missiles +', 'EMP', 'QED']),
    ],
    'power': [
        ('Systems', ['Power', 'Thrusters', 'Shields', 'Weapons', 'Throttle +', 'Throttle −', 'Power reset', 'Self destruct']),
        ('Distribution', ['Shields +', 'Weapons +', 'Engines +', 'Shields max', 'Weapons max', 'Engines max', 'Combat prep', 'Evade']),
    ],
    'industry': [
        ('Mining', ['Mining mode', 'Laser type', 'Module 1', 'Module 2', 'Module 3', 'Scan mode', 'Ping', 'Jettison cargo']),
        ('Salvage', ['Salvage mode', 'Fire left', 'Fire right', 'Fracture', 'Disintegrate', 'Focus all', 'Reset gimbal', 'Operator mode']),
    ],
    'onfoot': [
        ('Weapons', ['Primary', 'Secondary', 'Sidearm', 'Melee', 'Gadget', 'Reload', 'Lower weapon', 'Flashlight']),
        ('Gear & utility', ['Helmet on/off', 'Visor wipe', 'Third person', 'Crouch', 'Consume', 'Heal target', 'Tractor detach', 'Revive request']),
    ],
    'map': [
        ('Map', ['Local map', 'Go to selection', 'Step back', 'Plan route', 'Clear route', 'Starmap', 'QT actions', 'Advanced HUD']),
        ('Comms & screens', ['Reply 1', 'Reply 2', 'Reply 3', 'Reply 4', 'Scoreboard', 'Scan tab ▶', 'Contact ▼', 'MFD ▶']),
    ],
}

# ---------------------------------------------------------------------------
# Role pages. The panel reads which ship you sit in from Game.log,
# looks up its role in layouts/ships.json, and opens the role's page. Keys in
# NEEDS only show on ships that carry that kit; the slot stays empty otherwise.
# ---------------------------------------------------------------------------
ROLES = {
    'light-fighter': {'name': 'Light fighter', 'code': 'LFT', 'tab': 'combat', 'rows': [
        ('Targeting & guns', ['Lock 1', 'Lock 2', 'Unlock', 'Auto target', 'Look ahead', 'Gimbal mode', 'Guns group 1', 'Guns group 2']),
        ('Missiles & power', ['Missiles +', 'Decoy burst +', 'Shields +', 'Weapons +', 'Engines +', 'Power reset', 'Scan mode', 'Ping']),
    ]},
    'heavy-fighter': {'name': 'Heavy fighter', 'code': 'HFT', 'tab': 'combat', 'rows': [
        ('Targeting & guns', ['Lock 1', 'Lock 2', 'Lock 3', 'Unlock', 'Auto target', 'Gimbal mode', 'Guns group 1', 'Guns group 2']),
        ('Missiles & power', ['Missiles +', 'EMP', 'QED', 'Shields +', 'Weapons +', 'Engines +', 'Power reset', 'Ping']),
    ]},
    'multi-crew': {'name': 'Multi-crew', 'code': 'MCR', 'tab': 'flight', 'rows': [
        ('Ship', ['Power', 'Lights', 'Doors', 'Door locks', 'Operator mode', 'ATC request', 'Autoland', 'Power reset']),
        ('Weapons & power', ['Gimbal mode', 'Guns group 1', 'Lock 1', 'Unlock', 'Missiles +', 'Shields +', 'Weapons +', 'Engines +']),
    ]},
    'mining': {'name': 'Mining', 'code': 'MIN', 'tab': 'industry', 'rows': [
        ('Mining', ['Mining mode', 'Laser type', 'Module 1', 'Module 2', 'Module 3', 'Perm. module', 'Scan mode', 'Ping']),
        ('Ship', ['Lights', 'Doors', 'Lock rotation', 'Jettison cargo', 'Shields +', 'Engines +', 'ATC request', 'Operator mode']),
    ]},
    'salvage': {'name': 'Salvage', 'code': 'SLV', 'tab': 'industry', 'rows': [
        ('Salvage', ['Salvage mode', 'Fire left', 'Fire right', 'Fracture', 'Disintegrate', 'Focus all', 'Focus fracture', 'Head gimbal']),
        ('Ship', ['Reset gimbal', 'Jettison cargo', 'Scan mode', 'Ping', 'Lights', 'Lock rotation', 'Shields +', 'Engines +']),
    ]},
    'cargo': {'name': 'Cargo', 'code': 'CRG', 'tab': 'flight', 'rows': [
        ('Ship & doors', ['Doors', 'Door locks', 'Loading area', 'Port locks', 'Lights', 'Power', 'Operator mode', 'ATC request']),
        ('Tractor & power', ['Beam closer', 'Beam farther', 'Tractor detach', 'Tractor rotate', 'Autoland', 'Shields +', 'Engines +', 'Scan mode']),
    ]},
    'medical': {'name': 'Medical', 'code': 'MED', 'tab': 'flight', 'rows': [
        ('Ship & doors', ['Doors', 'Door locks', 'Loading area', 'Lights', 'Power', 'Operator mode', 'ATC request', 'Autoland']),
        ('Sensors & power', ['Scan mode', 'Ping', 'Freelook', 'Shields +', 'Engines +', 'Power reset', 'Gimbal mode', 'Guns group 1']),
    ]},
    'ground': {'name': 'Ground vehicle', 'code': 'GND', 'tab': 'flight', 'rows': [
        ('Vehicle', ['Power', 'Lights', 'Doors', 'Look behind', 'Third person', 'Freelook', 'Operator mode', 'Scan mode']),
        ('Weapons & power', ['Gimbal mode', 'Guns group 1', 'Lock 1', 'Unlock', 'Shields +', 'Weapons +', 'Engines +', 'Power reset']),
    ]},
}
# Pages the panel opens on game events rather than from a rail tab.
# 'tab' is the rail tab that lights up while the page shows.
EVENT_PAGES = {
    'emotes': {'name': 'Emotes', 'tab': 'onfoot', 'rows': [
        ('Signals', ['Signal forward', 'Signal left', 'Signal right', 'Signal stop', 'Signal yes', 'Signal no', 'Wave', 'Salute']),
        ('Emotes', ['Point', 'Come', 'Wait', 'Agree', 'Disagree', 'Cheer', 'Clap', 'Laugh']),
    ]},
    'downed': {'name': 'Downed', 'tab': 'onfoot', 'rows': [
        ('Medical', ['Revive request', 'Give up', 'Consume', 'Heal target', 'mobiGlas', 'Visor wipe', 'Helmet on/off', 'Third person']),
        ('Comms & map', ['Reply 1', 'Reply 2', 'Reply 3', 'Reply 4', 'Local map', 'Plan route', 'Scoreboard', 'Flashlight']),
    ]},
}

# With two virtual decks side by side, the left one is a fixed cockpit panel: one
# page that never changes, with the ship systems you reach for on any page. The
# right one is the deck above, rail and all.
LEFT = [
    ('Systems', ['Power', 'Thrusters', 'Shields', 'Weapons', 'Lights', 'Doors', 'Door locks', 'VTOL']),
    ('Flight assists', ['NAV / SCM', 'Cruise throttle', 'Speed limiter', 'G-safe', 'ESP', 'Proximity assist', 'Lock rotation', 'Freelook']),
    ('Landing & sensors', ['Startup', 'ATC request', 'Autoland', 'Loading area', 'Scan mode', 'Ping', 'Look behind', 'Starmap']),
    ('Power', ['Shields +', 'Weapons +', 'Engines +', 'Power reset', 'Throttle +', 'Throttle −', 'Combat prep', 'Evade']),
]

# Second actions on a key: a double tap or a long
# press sends another action. Only on plain keys, and only tap actions, so the
# main action stays where it was.
MORE = {
    'Decoy': {'hold': 'Panic decoy'},
    'Shields +': {'hold': 'Shields −'},
    'Weapons +': {'hold': 'Weapons −'},
    'Engines +': {'hold': 'Engines −'},
    'Throttle +': {'hold': 'Throttle max'},
    'Throttle −': {'hold': 'Throttle min'},
    'Missiles +': {'hold': 'Missiles reset'},
    'Unlock': {'hold': 'Clear pins'},
    'ATC request': {'double': 'Docking request'},
    'Local map': {'hold': 'My location'},
    'Decoy burst +': {'hold': 'Decoy burst −'},
    'Reply 4': {'hold': 'Reply 5'},
    'Scan tab ▶': {'hold': 'Scan tab ◀'},
    'Contact ▼': {'hold': 'Contact ▲'},
    'MFD ▶': {'hold': 'MFD ◀'},
}

# One tap runs a sequence. A step is a key label,
# a pause in milliseconds, or ('page', id) to open a deck page at the end.
MACROS = {
    'Startup': {'glyph': 'ready', 'steps': ['Flight ready', 3000, 'ATC request']},
    'Combat prep': {'glyph': 'crosshair', 'steps': ['Power reset', 'Weapons +', 'Weapons +', 'Shields +', ('page', 'combat')]},
    'All systems on': {'glyph': 'power', 'steps': ['Power on', 'Thrusters on', 'Shields on', 'Weapons on', 300, 'Flight ready']},
    'Evade': {'glyph': 'flame', 'steps': ['Power reset', 'Engines +', 'Engines +', 'Shields +', 'Decoy', 'Noise']},
}

NEEDS = {
    'Missiles +': 'missiles', 'Missiles reset': 'missiles', 'QED': 'qed', 'EMP': 'emp',
    'Beam closer': 'tractor', 'Beam farther': 'tractor', 'Tractor detach': 'tractor', 'Tractor rotate': 'tractor',
}

NAMES = {'flight': 'Flight', 'combat': 'Combat', 'power': 'Power', 'industry': 'Mining & salvage',
         'onfoot': 'On foot', 'map': 'Map & comms'}

# Per-page look: accent colour and a short code.
THEMES = {
    'flight':   {'accent': '#5cc8e6', 'code': 'FLT', 'glyph': 'ship'},
    'combat':   {'accent': '#ff5d6c', 'code': 'CBT', 'glyph': 'crosshair'},
    'power':    {'accent': '#a78bfa', 'code': 'PWR', 'glyph': 'power'},
    'industry': {'accent': '#e9c46a', 'code': 'IND', 'glyph': 'pickaxe'},
    'onfoot':   {'accent': '#6fd08c', 'code': 'FPS', 'glyph': 'helmet'},
    'map':      {'accent': '#9fb4ff', 'code': 'NAV', 'glyph': 'map'},
}

# Panels drawn around related keys: (label, row, col, width, height), 0-based.

# Keys that flip a state. The deck can't read the game's real state, so it
# shows what the last press should have set; labels are [on, off].
TOGGLES = {
    'v_weapon_gimbals_state_toggle': ('gimbal', ['LOCKED', 'FREE']),
    'v_toggle_landing_system': ('gear', ['DOWN', 'UP']),
    'v_vtol_toggle': ('vtol', ['ON', 'OFF']),
    'v_ifcs_vector_decoupling_toggle': ('decoupled', ['DECOUPLED', 'COUPLED']),
    'v_ifcs_speed_limiter_toggle': ('limiter', ['ON', 'OFF']),
    'v_ifcs_toggle_gforce_safety': ('gsafe', ['ON', 'OFF']),
    'v_ifcs_toggle_esp': ('esp', ['ON', 'OFF']),
    'v_ifcs_proximity_assist_toggle': ('prox', ['ON', 'OFF']),
    'v_lock_rotation': ('rotlock', ['LOCKED', 'FREE']),
    'v_toggle_scan_mode': ('scan', ['SCAN', 'OFF']),
    'v_lights': ('lights', ['ON', 'OFF']),
    'v_toggle_all_doors': ('doors', ['OPEN', 'CLOSED']),
    'v_toggle_all_doorlocks': ('doorlocks', ['LOCKED', 'OPEN']),
    'v_power_toggle': ('power', ['ON', 'OFF']),
    'v_power_toggle_thrusters': ('pwr_thr', ['ON', 'OFF']),
    'v_power_toggle_shields': ('pwr_shd', ['ON', 'OFF']),
    'v_power_toggle_weapons': ('pwr_wpn', ['ON', 'OFF']),
    'v_weapon_staggered_fire_toggle': ('stagger', ['ON', 'OFF']),
    'v_look_ahead_enable': ('lookahead', ['ON', 'OFF']),
    'v_toggle_mining_mode': ('industrial', ['ACTIVE', 'OFF']),
    'v_toggle_salvage_mode': ('industrial', ['ACTIVE', 'OFF']),
    'v_flight_advanced_hud_toggle': ('advhud', ['ON', 'OFF']),
    'toggle_flashlight': ('flashlight', ['ON', 'OFF']),
    'toggleEquipHelmet': ('helmet', ['ON', 'OFF']),
    'toggle_lowered': ('lowered', ['LOWERED', 'READY']),
}
# Keys that set one value of a shared state directly: (state key, value, [on label]).
SETS = {
    'v_power_set_on': ('power', True),
    'v_power_set_off': ('power', False),
    'v_power_set_thrusters_on': ('pwr_thr', True),
    'v_power_set_thrusters_off': ('pwr_thr', False),
    'v_power_set_shields_on': ('pwr_shd', True),
    'v_power_set_shields_off': ('pwr_shd', False),
    'v_power_set_weapons_on': ('pwr_wpn', True),
    'v_power_set_weapons_off': ('pwr_wpn', False),
    'v_lights_on': ('lights', True),
    'v_lights_off': ('lights', False),
    'v_vtol_on': ('vtol', True),
    'v_vtol_off': ('vtol', False),
    'v_ifcs_speed_limiter_on': ('limiter', True),
    'v_ifcs_speed_limiter_off': ('limiter', False),
    'v_ifcs_vector_decoupling_on': ('decoupled', True),
    'v_ifcs_vector_decoupling_off': ('decoupled', False),
    'v_ifcs_gsafe_on': ('gsafe', True),
    'v_ifcs_gsafe_off': ('gsafe', False),
    'v_ifcs_proximity_assist_on': ('prox', True),
    'v_ifcs_proximity_assist_off': ('prox', False),
    'v_flight_advanced_hud_on': ('advhud', True),
    'v_flight_advanced_hud_off': ('advhud', False),
    'v_ifcs_stability_on': ('stability', True),
    'v_ifcs_stability_off': ('stability', False),
    'v_ifcs_gravity_compensation_on': ('gravcomp', True),
    'v_ifcs_gravity_compensation_off': ('gravcomp', False),
    'v_weapon_staggered_fire_on': ('stagger', True),
    'v_weapon_staggered_fire_off': ('stagger', False),
    'v_master_mode_set_nav': ('navmode', 'nav'),
    'v_master_mode_set_scm': ('navmode', 'scm'),
    'v_weapon_gimbals_state_set_locked': ('gimbal', True),
    'v_weapon_gimbals_state_set_unlocked': ('gimbal', False),
    'v_weapon_preset_guns0': ('guns', 0),
    'v_weapon_preset_guns1': ('guns', 1),
    'v_weapon_preset_guns2': ('guns', 2),
    'v_weapon_preset_guns3': ('guns', 3),
}
# Keys with their own animation on the deck.
ANIMS = {'v_toggle_qdrive_engagement': 'spool', 'v_invoke_ping': 'radar'}

MENU_ACTIONS = {'mobiglas', 'v_starmap', 'v_hud_open_scoreboard', 'thirdperson'}


def role(action, actionmap, press, state):
    """How a key should look: critical, toggle, select, hold, menu or action."""
    if press == 'danger':
        return 'critical'
    if state:
        return 'select' if state['kind'] == 'set' else 'toggle'
    if press == 'hold':
        return 'hold'
    if actionmap in ('mapui', 'spaceship_scanning', 'vehicle_mfd') or action in MENU_ACTIONS or action.startswith('pc_conversation'):
        return 'menu'
    return 'action'


def load_actions(path):
    acts = {}
    for am in ET.parse(path).getroot().iter('actionmap'):
        for a in am.findall('action'):
            kb = (a.get('keyboard') or '').strip()
            acts.setdefault(a.get('name'), (am.get('name'), kb, a.get('activationMode', '')))
    return acts


# Keys only the console's own plates use.
EXTRAS = ['Open doors', 'Close doors', 'Chat window', 'Push to talk',
          'Power on', 'Power off', 'Thrusters on', 'Thrusters off', 'Shields on', 'Shields off', 'Weapons on', 'Weapons off', 'Lights on', 'Lights off', 'VTOL on', 'VTOL off', 'Speed limiter on', 'Speed limiter off', 'Decoupled on', 'Decoupled off', 'G-safe on', 'G-safe off', 'Proximity assist on', 'Proximity assist off', 'Advanced HUD on', 'Advanced HUD off', 'Stability on', 'Stability off', 'Gravity comp on', 'Gravity comp off', 'Staggered fire on', 'Staggered fire off', 'Set NAV', 'Set SCM', 'Panic decoy', 'Hail target', 'All systems on',
          'Dance', 'Bow', 'Greet', 'Threaten', 'Taunt', 'Rude', 'Sit', 'Sleep', 'Flex', 'Gloat', 'Angry', 'At ease', 'Attention', 'Whistle']


def make_cell(cell, acts, missing):
    """A deck key from a page cell: a catalog key (with its long press and double tap extras) or a macro."""
    label = cell[0] if isinstance(cell, tuple) else cell
    if label in MACROS:
        return make_macro(label, acts, missing)
    key = make_key(spec_of(cell), acts, missing)
    if key and label in MORE and key['role'] in ('action', 'menu'):
        key['more'] = {}
        for how, other in MORE[label].items():
            sub = make_key(spec_of(other), acts, missing)
            assert sub and sub['press'] == 'tap' and 'state' not in sub, f'{label}: {other} must be a plain tap key'
            key['more'][how] = sub
    return key


def make_macro(label, acts, missing):
    steps = []
    for st in MACROS[label]['steps']:
        if isinstance(st, int):
            steps.append({'delay': st})
        elif isinstance(st, tuple):
            assert st[0] == 'page' and st[1] in PAGES, st
            steps.append({'page': st[1]})
        else:
            sub = make_key(spec_of(st), acts, missing)
            # Toggles would leave the result unknown; keys that set a state are fine.
            assert sub is None or (sub['press'] == 'tap' and sub.get('state', {}).get('kind', 'set') == 'set'), f'{label}: {st} must be a tap key that toggles nothing'
            steps.append({'key': sub})
    return {'label': label, 'action': None, 'actionmap': None, 'defaultKey': None, 'activation': '',
            'press': 'tap', 'needsKeyboardBind': False, 'icon': MACROS[label]['glyph'], 'role': 'macro', 'steps': steps}


def make_key(spec, acts, missing):
    label, action, press, glyph = spec[:4]
    span = spec[4] if len(spec) > 4 else 1
    if action not in acts:
        missing.append(action)
        return None
    actionmap, kb, activation = acts[action]
    keyboard = bool(kb) and not any(m in kb for m in ('mouse', 'mwheel', 'maxis'))
    key = {'label': label, 'action': action, 'actionmap': actionmap, 'defaultKey': kb if keyboard else None,
           'activation': activation, 'press': press, 'needsKeyboardBind': not keyboard, 'icon': glyph}
    if span > 1:
        key['span'] = span
    if action in TOGGLES:
        skey, labels = TOGGLES[action]
        key['state'] = {'key': skey, 'kind': 'toggle', 'labels': labels}
    elif action in SETS:
        skey, value = SETS[action]
        key['state'] = {'key': skey, 'kind': 'set', 'value': value}
    if action in ANIMS:
        key['anim'] = ANIMS[action]
    key['role'] = role(action, actionmap, press, key.get('state'))
    return key


def spec_of(cell):
    label, span = cell if isinstance(cell, tuple) else (cell, 1)
    if label not in CATALOG:
        sys.exit(f'No key labelled {label!r} in CATALOG')
    return (label, *CATALOG[label]) + ((span,) if span > 1 else ())


def page_rows(content, acts, missing, lacks=frozenset()):
    """The two content rows plus the fixed flight and panic row, as 3 rows of 8 cells (the rail is the 4th)."""
    rows = []
    for cells in [c for _, c in content] + [FLIGHT_ROW + PANIC]:
        width = sum(c[1] if isinstance(c, tuple) else 1 for c in cells)
        assert width == COLUMNS, (cells, width)
        row = []
        for cell in cells:
            label = cell[0] if isinstance(cell, tuple) else cell
            row.append(None if NEEDS.get(label) in lacks else make_cell(cell, acts, missing))
        rows.append(row)
    return rows


def groups_of(content):
    return [{'label': label, 'row': r, 'col': 0, 'w': COLUMNS, 'h': 1} for r, (label, _) in enumerate(content)] + \
           [{'label': g[0], 'row': g[1], 'col': g[2], 'w': g[3], 'h': g[4]} for g in FIXED_GROUPS]


def role_variants(ships):
    """For each role, the sets of kit its ships lack, so each gets a page without those keys."""
    out = {}
    for rid, role in ROLES.items():
        kit = {NEEDS[c[0] if isinstance(c, tuple) else c] for _, cells in role['rows'] for c in cells
               if (c[0] if isinstance(c, tuple) else c) in NEEDS}
        seen = {frozenset()}
        for ship in ships.values():
            if ship['role'] == rid:
                seen.add(frozenset(kit - set(ship['has'])))
        out[rid] = sorted(seen, key=lambda s: (len(s), sorted(s)))
    return out


def main(path):
    acts = load_actions(path)
    ships = json.loads((Path(__file__).resolve().parent.parent / 'layouts/ships.json').read_text(encoding='utf-8'))['ships']
    missing = []
    pages = []
    for pid, content in PAGES.items():
        pages.append({'id': pid, 'name': NAMES[pid], 'theme': THEMES[pid], 'profile': 'main',
                      'groups': groups_of(content), 'rows': page_rows(content, acts, missing)})
    for pid, ev in EVENT_PAGES.items():
        pages.append({'id': pid, 'name': ev['name'], 'theme': THEMES[ev['tab']], 'profile': 'main', 'tab': ev['tab'],
                      'event': True, 'groups': groups_of(ev['rows']), 'rows': page_rows(ev['rows'], acts, missing)})
    for rid, lacks_list in role_variants(ships).items():
        role = ROLES[rid]
        theme = dict(THEMES[role['tab']], code=role['code'])
        for lacks in lacks_list:
            pid = rid + ''.join(f'--no-{k}' for k in sorted(lacks))
            pages.append({'id': pid, 'name': role['name'], 'theme': theme, 'profile': rid,
                          'role': {'id': rid, 'tab': role['tab'], 'lacks': sorted(lacks)},
                          'groups': groups_of(role['rows']), 'rows': page_rows(role['rows'], acts, missing, lacks)})

    pages.append({'id': 'left', 'name': 'Left deck', 'theme': dict(THEMES['flight'], code='CTL'), 'profile': 'left', 'side': 'left',
                  'groups': [{'label': label, 'row': r, 'col': 0, 'w': COLUMNS, 'h': 1} for r, (label, _) in enumerate(LEFT)],
                  'rows': [[make_cell(c, acts, missing) for c in cells] for _, cells in LEFT]})

    rail = [{'label': NAMES[p], 'type': 'page', 'page': p, 'theme': THEMES[p]} for p in PAGES]
    for label in ('mobiGlas', 'Starmap'):
        k = make_key(spec_of(label), acts, missing)
        if k:
            k['type'] = 'action'
            rail.append(k)
    # Keys the console uses that no deck page shows.
    extras = [make_cell(label, acts, missing) for label in EXTRAS]
    if missing:
        sys.exit('Unknown actions: ' + ', '.join(sorted(set(missing))))

    out = {
        'format': 'xeneon-sc-deck/3',
        'source': 'Star Citizen defaultProfile.xml',
        'device': {'name': 'Corsair Xeneon Edge', 'resolution': [2560, 720]},
        'decks': [{'id': 'rail', 'grid': [COLUMNS, 1], 'keys': rail},
                  {'id': 'main', 'grid': [COLUMNS, ROWS - 1], 'pages': pages},
                  {'id': 'extras', 'keys': [k for k in extras if k]}],
        'roles': [{'id': rid, 'name': r['name'], 'code': r['code'], 'tab': r['tab']} for rid, r in ROLES.items()],
                # Pages the panel opens on game events.
        'defaultPages': {'seated': 'flight', 'onFoot': 'onfoot', 'downed': 'downed', 'menu': 'flight'},
    }
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1])
