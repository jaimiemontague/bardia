/**
 * Shared painting and staging code for full-screen scenes (ARCHITECTURE §20.7): the light of the hour,
 * sky/sea/land layers, ships, people and settlements, the composed pictures, the attention cue, the scene
 * frame and its big choices, and final-art substitution by asset id.
 */
export * from './paint';
export { SceneSvg, Sky, Sea, Ridge, HorizonHaze, FogBank, Rain, Smoke, useSceneUid } from './layers';
export { SideShip, OwnBow, OwnSailHem, shipPaint, SHIP_LOOK, type ShipPaint } from './ships';
export { Figure, Tree, Woods, Heath, OwnSpears } from './land';
export { SettlementView, styleOfCulture, tierPlan, type BuildStyle, type SettlementViewProps } from './settlement';
export { EncounterPicture, SettlementPicture, MAX_DRAWN_SHIPS, type Ambience, type EncounterPictureModel, type SettlementPictureModel } from './pictures';
export { SceneStage, useFreshKeys, CUE_MS, CUE_STILL_MS, type CueSpec, type CueSound, type CueGlyph } from './SceneStage';
export { SceneLayout, firstSentences, type SceneLayoutProps } from './SceneLayout';
export { SceneChoices, type SceneChoiceItem, type SceneChoiceTone } from './SceneChoices';
export { Painting, useFinalPainting } from './finalArt';
export { ambienceOf, oddsBand, approxMen, compassWord, type OddsBand } from './ambience';
