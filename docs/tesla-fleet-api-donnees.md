# Données disponibles via l'API Fleet de Tesla

*Compilé le 23/11/2026.*

**Sources**
- Flux temps réel : [vehicle_data.proto](https://github.com/teslamotors/fleet-telemetry/blob/main/protos/vehicle_data.proto). C'est le fichier officiel de Tesla, et la liste ci-dessous en est complète.
- Interrogation ponctuelle : [exemple de réponse](https://github.com/timdorr/tesla-api/blob/master/docs/vehicle/state/data.md) issu d'une documentation communautaire, donc non officielle et un peu ancienne. La [documentation officielle](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints) ne détaille pas les champs.

L'API Fleet propose deux façons d'obtenir les données :

| | **Fleet Telemetry** (flux temps réel) | **vehicle_data** (interrogation ponctuelle) |
|---|---|---|
| Principe | La voiture envoie les valeurs dès qu'elles changent (au plus 1 fois/seconde par champ) | On demande l'état de la voiture à un instant donné |
| Usage | Tableau de bord en direct, enregistrement de trajets | Affichage occasionnel (batterie, verrouillage…) |
| Coût | Facturé par signal reçu | Facturé par appel. Tesla déconseille d'interroger régulièrement : c'est cher et ça réveille la voiture. |
| Nombre de données | ~250 champs | ~150 champs |

---

## Pour ton tableau de bord

| Ce que tu veux | Champ Telemetry | Verdict |
|---|---|---|
| Vitesse | `VehicleSpeed` | ✅ Disponible |
| Consommation instantanée | `PackVoltage` × `PackCurrent` = puissance en kW | ✅ À calculer |
| Consommation moyenne du trajet | Écart de `LifetimeEnergyUsed` ÷ écart de `Odometer` depuis le départ | ✅ À calculer |
| Limitation de vitesse de la route | Aucun champ. `CurrentLimitMph` est la vitesse maximale du **bridage** que tu règles toi-même (Speed Limit Mode), pas le panneau de la route. | ❌ Non disponible |
| Engagement de l'Autopilot | Aucun champ direct. Pistes à tester : `SelfDrivingMilesSinceReset` augmente-t-il quand la conduite autonome est active ? `CruiseSetSpeed` est-il renseigné quand le régulateur est actif ? | ⚠️ Indirect, non garanti |

**Bonus intéressants** : `GradeEstimatePercent` (pente de la route), `LateralAcceleration` / `LongitudinalAcceleration` (accélérations), `ExpectedEnergyPercentAtTripArrival` (batterie prévue à l'arrivée), `OutsideTemp` (la température influe beaucoup sur la consommation), `HvacPower` (part de la clim/chauffage dans la consommation).

---

## A. Fleet Telemetry : liste complète des champs (flux temps réel)

### 1. Conduite et mouvement
| Champ | Signification |
|---|---|
| `VehicleSpeed` | Vitesse du véhicule |
| `Odometer` | Kilométrage total |
| `Gear` | Rapport engagé (P, R, N, D) |
| `PedalPosition` | Position de l'accélérateur |
| `BrakePedal` | Frein enfoncé (oui/non) |
| `BrakePedalPos` | Position de la pédale de frein |
| `LateralAcceleration` | Accélération latérale (virages) |
| `LongitudinalAcceleration` | Accélération/freinage |
| `CruiseSetSpeed` | Vitesse réglée du régulateur |
| `CruiseFollowDistance` | Distance de suivi du régulateur adaptatif |
| `GradeEstimatePercent` | Pente estimée de la route (%) |
| `MilesSinceReset` | Distance depuis la dernière remise à zéro |
| `SelfDrivingMilesSinceReset` | Distance en conduite autonome depuis la remise à zéro |
| `RollingResistanceCoefficient` | Coefficient de résistance au roulement |
| `DriveRail`, `AccessoryRail` | Alimentation des systèmes de traction / accessoires active |

### 2. Position et navigation
| Champ | Signification |
|---|---|
| `Location` | Coordonnées GPS (nécessite la permission « localisation ») |
| `GpsState`, `GpsHeading`, `GpsAccuracyMeters` | État du GPS, cap, précision en mètres |
| `LocatedAtHome`, `LocatedAtWork`, `LocatedAtFavorite` | Voiture à un lieu enregistré |
| `OriginLocation`, `DestinationLocation`, `DestinationName` | Départ et destination de la navigation en cours |
| `RouteLine`, `RouteLastUpdated` | Tracé de l'itinéraire, date de mise à jour |
| `MilesToArrival`, `MinutesToArrival` | Distance et temps restants |
| `RouteTrafficMinutesDelay` | Retard dû au trafic |
| `ExpectedEnergyPercentAtTripArrival` | Batterie estimée à l'arrivée (%) |
| `MaxSpeedToReachDestinationMph` | Vitesse max conseillée pour arriver avec assez de batterie |
| `SuperchargerSessionTripPlanner` | Recharge Superchargeur prévue par le planificateur |

### 3. Batterie et énergie
| Champ | Signification |
|---|---|
| `PackVoltage`, `PackCurrent` | Tension et courant de la batterie (→ puissance instantanée) |
| `Soc`, `BatteryLevel` | Niveau de charge (%) |
| `EnergyRemaining` | Énergie restante (kWh) |
| `NominalFullPackEnergyKwh` | Capacité de la batterie pleine (kWh), utile pour suivre l'usure |
| `RatedRange`, `EstBatteryRange`, `IdealBatteryRange` | Autonomie : homologuée, estimée, idéale |
| `LifetimeEnergyUsed` | Énergie totale consommée depuis la naissance de la voiture |
| `LifetimeEnergyGainedRegen` | Énergie totale récupérée au freinage |
| `LifetimeEnergyChargedKwh`, `LifetimeDcChargeEnergyKwh` | Énergie totale chargée (toutes charges / charges rapides) |
| `BrickVoltageMax`, `BrickVoltageMin`, `NumBrickVoltageMax`, `NumBrickVoltageMin` | Tension des cellules la plus haute/basse et leur numéro |
| `ModuleTempMax`, `ModuleTempMin`, `NumModuleTempMax`, `NumModuleTempMin` | Température des modules la plus haute/basse et leur numéro |
| `BrickSocMinPercent` | Charge de la cellule la plus faible |
| `BMSState`, `BmsFullchargecomplete` | État du système de gestion de batterie, charge complète atteinte |
| `BatteryHeaterOn`, `NotEnoughPowerToHeat` | Chauffage batterie actif / puissance insuffisante pour chauffer |
| `IsolationResistance`, `Hvil`, `DCDCEnable` | Diagnostics haute tension et convertisseur 12 V |
| `EfficiencyPackage` | Version du pack d'efficacité |

### 4. Moteurs et onduleurs
Suffixes : `F` = moteur avant, `R` = arrière, `REL`/`RER` = arrière gauche/droit (versions tri-moteur).
| Champ | Signification |
|---|---|
| `DiStateF/R/REL/RER` | État de chaque moteur |
| `DiTorquemotor`, `DiTorqueActualF/R/REL/RER`, `DiSlaveTorqueCmd` | Couple demandé / réel |
| `DiAxleSpeedF/R/REL/RER` | Vitesse de rotation des essieux |
| `DiMotorCurrentF/R/REL/RER` | Courant moteur |
| `DiVBatF/R/REL/RER` | Tension vue par chaque moteur |
| `DiStatorTempF/R/REL/RER` | Température du moteur |
| `DiHeatsinkTF/TR/TREL/TRER`, `DiInverterTF/TR/TREL/TRER` | Températures des onduleurs |

### 5. Charge
| Champ | Signification |
|---|---|
| `ChargeState`, `DetailedChargeState` | État de charge (en charge, terminé, déconnecté…) |
| `ChargeLimitSoc` | Limite de charge réglée (%) |
| `ACChargingPower`, `ACChargingEnergyIn` | Puissance / énergie en charge lente (AC) |
| `DCChargingPower`, `DCChargingEnergyIn` | Puissance / énergie en charge rapide (DC) |
| `ChargeAmps`, `ChargeCurrentRequest`, `ChargeCurrentRequestMax`, `ChargerVoltage`, `ChargerPhases` | Courant, tension, nombre de phases |
| `ChargeRateMilePerHour` | Vitesse de charge (autonomie gagnée par heure) |
| `TimeToFullCharge`, `EstimatedHoursToChargeTermination` | Temps restant de charge |
| `FastChargerPresent`, `FastChargerType`, `ChargingCableType` | Type de borne et de câble |
| `ChargePort`, `ChargePortLatch`, `ChargePortDoorOpen`, `ChargePortColdWeatherMode` | Prise de charge : type, verrou, trappe, mode froid |
| `ChargeEnableRequest` | Charge demandée |
| `ScheduledChargingMode`, `ScheduledChargingStartTime`, `ScheduledChargingPending`, `ScheduledDepartureTime`, `PreconditioningEnabled` | Charge programmée et départ programmé |
| `PowerTransferStatus` | État du transfert d'énergie |

### 6. Aides à la conduite et sécurité
| Champ | Signification |
|---|---|
| `SpeedLimitMode`, `CurrentLimitMph` | Bridage de vitesse réglé par le conducteur (actif ? valeur ?) |
| `SpeedLimitWarning` | Réglage de l'alerte de dépassement de vitesse |
| `ForwardCollisionWarning` | Réglage de l'alerte de collision |
| `LaneDepartureAvoidance`, `EmergencyLaneDepartureAvoidance` | Réglages du maintien dans la voie |
| `AutomaticEmergencyBrakingOff`, `AutomaticEmergencyBrakingState` | Freinage d'urgence automatique |
| `AutomaticBlindSpotCamera`, `BlindSpotCollisionWarningChime` | Caméra et alerte d'angle mort |
| `SelfDrivingSoftwareVersion` | Version du logiciel de conduite autonome |
| `DriverSeatBelt`, `PassengerSeatBelt`, `DriverSeatOccupied` | Ceintures, présence du conducteur |

### 7. Climatisation et confort
| Champ | Signification |
|---|---|
| `InsideTemp`, `OutsideTemp` | Températures intérieure / extérieure |
| `HvacPower` | Consommation de la clim/chauffage |
| `HvacACEnabled`, `HvacAutoMode`, `HvacFanSpeed`, `HvacFanStatus` | État de la climatisation |
| `HvacLeftTemperatureRequest`, `HvacRightTemperatureRequest` | Températures demandées |
| `HvacSteeringWheelHeatAuto`, `HvacSteeringWheelHeatLevel` | Volant chauffant |
| `SeatHeaterLeft/Right/RearLeft/RearRight/RearCenter`, `RearSeatHeaters` | Sièges chauffants |
| `AutoSeatClimateLeft/Right`, `ClimateSeatCoolingFrontLeft/Right`, `SeatVentEnabled` | Climatisation automatique et ventilation des sièges |
| `ClimateKeeperMode` | Mode Chien / Camping / Maintien clim |
| `CabinOverheatProtectionMode`, `CabinOverheatProtectionTemperatureLimit` | Protection contre la surchauffe de l'habitacle |
| `DefrostMode`, `DefrostForPreconditioning`, `RearDefrostEnabled`, `WiperHeatEnabled` | Dégivrage |
| `RearDisplayHvacEnabled` | Commande de clim à l'écran arrière |

### 8. Ouvrants, accès et éclairage
| Champ | Signification |
|---|---|
| `DoorState`, `Locked` | Portes et verrouillage |
| `FdWindow`, `FpWindow`, `RdWindow`, `RpWindow` | Vitres (avant/arrière, conducteur/passager) |
| `SentryMode` | Mode Sentinelle |
| `ValetModeEnabled`, `GuestModeEnabled`, `GuestModeMobileAccessState`, `PinToDriveEnabled` | Modes voiturier, invité, code PIN |
| `PairedPhoneKeyAndKeyFobQty` | Nombre de clés et téléphones associés |
| `RemoteStartEnabled`, `RemoteStartActive` | Démarrage à distance |
| `HomelinkDeviceCount`, `HomelinkNearby` | Ouvre-portail HomeLink |
| `LightsHazardsActive`, `LightsTurnSignal`, `LightsHighBeams` | Warnings, clignotants, pleins phares |
| `CenterDisplay` | État de l'écran central |
| `ServiceMode` | Mode atelier |
| `SunroofInstalled` | Toit ouvrant présent |

### 9. Pneus
| Champ | Signification |
|---|---|
| `TpmsPressureFl/Fr/Rl/Rr` | Pression de chaque pneu |
| `TpmsLastSeenPressureTimeFl/Fr/Rl/Rr` | Date de la dernière mesure |
| `TpmsHardWarnings`, `TpmsSoftWarnings` | Alertes de pression |

### 10. Multimédia
`MediaPlaybackStatus`, `MediaPlaybackSource`, `MediaAudioVolume`, `MediaAudioVolumeIncrement`, `MediaAudioVolumeMax`, `MediaNowPlayingTitle`, `MediaNowPlayingArtist`, `MediaNowPlayingAlbum`, `MediaNowPlayingStation`, `MediaNowPlayingDuration`, `MediaNowPlayingElapsed`. Ces champs donnent la lecture en cours, la source, le volume, le titre, l'artiste, l'album, la station, la durée et la progression.

### 11. Logiciel
`Version` (version installée), `SoftwareUpdateAvailable`, `SoftwareUpdateInProgress`, `SoftwareUpdateVersion`, `SoftwareUpdateDownloadPercentComplete`, `SoftwareUpdateInstallationPercentComplete`, `SoftwareUpdateExpectedDurationMinutes`, `SoftwareUpdateScheduledStartTime`.

### 12. Configuration du véhicule et réglages
`VehicleName`, `CarType`, `Trim`, `ExteriorColor`, `RoofColor`, `WheelType`, `RightHandDrive`, `EuropeVehicle`, `OffroadLightbarPresent`, `SettingDistanceUnit`, `SettingTemperatureUnit`, `SettingTirePressureUnit`, `SettingChargeUnit`, `Setting24HourTime`.

### 13. Champs sans intérêt pour une Model Y
- **Cybertruck** : `Powershare*` (5 champs, alimentation de la maison), `Tonneau*` (3 champs, couvre-benne).
- **Semi (camion)** : 17 champs `Semitruck*` / `Semi*`, plus `LifetimeEnergyUsedDrive`, `Cabin12vPortKeepOn` et `Cabin48vPortKeepOn`.
- **Réservés par Tesla** : `Experimental_1` à `Experimental_15`, `Deprecated_1` à `3`, `Unknown`.

---

## B. vehicle_data : interrogation ponctuelle

La réponse est organisée en 6 blocs. La liste vient d'un exemple communautaire : des champs ont pu être ajoutés ou retirés depuis.

| Bloc | Contenu principal |
|---|---|
| **drive_state** (conduite) | `speed` (vitesse), `power` (puissance instantanée en kW), `shift_state` (rapport), `heading` (cap), `latitude`/`longitude` (position, avec le paramètre `location_data`). |
| **charge_state** (batterie et charge) | `battery_level`, `usable_battery_level`, `battery_range`, `est_battery_range`, `ideal_battery_range`, `charging_state`, `charge_limit_soc`, `charge_energy_added`, `charger_power`, `charger_voltage`, `charger_actual_current`, `charge_rate`, `minutes_to_full_charge`, `fast_charger_type`, `fast_charger_brand`, `conn_charge_cable`, `scheduled_charging_start_time`, `charge_port_door_open`, `battery_heater_on`… (~45 champs) |
| **climate_state** (climatisation) | `inside_temp`, `outside_temp`, `is_climate_on`, `driver_temp_setting`, `passenger_temp_setting`, `fan_status`, `seat_heater_*`, `is_preconditioning`, `climate_keeper_mode`, `defrost_mode`, `bioweapon_mode`… (~25 champs) |
| **vehicle_state** (état général) | `odometer`, `locked`, `sentry_mode`, `speed_limit_mode`, `car_version` (logiciel), `software_update`, portes (`df`, `dr`, `pf`, `pr`), coffres (`ft`, `rt`), vitres, `is_user_present`, `valet_mode`, `homelink_nearby`, `remote_start`, `vehicle_name`… (~40 champs) |
| **gui_settings** (unités d'affichage) | Unités de distance, de température et de charge, format 24 h. |
| **vehicle_config** (configuration) | `car_type`, `trim_badging`, `exterior_color`, `wheel_type`, `has_air_suspension`, `eu_vehicle`, `rhd`, `seat_type`, `charge_port_type`… (~25 champs) |

**À savoir :**
- `vehicle_data_cached` renvoie la **dernière valeur connue sans réveiller la voiture**, mais sans le bloc `drive_state`, ni la position, ni les médias. Les données peuvent dater de plusieurs heures.
- Depuis le logiciel 2023.38, demander la position fait apparaître une icône de partage de localisation sur l'écran de la voiture.
- `drive_state.power` donne directement la puissance instantanée. En flux temps réel, il faut la calculer (tension × courant).
