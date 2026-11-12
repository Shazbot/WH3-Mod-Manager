// Node-free so renderer components can import it.
export const MIXER_PACK_NAME = "!b_mixer.pack";

export const isMixerPackName = (name: string) => name.toLowerCase() === MIXER_PACK_NAME;

export const hasEnabledMixer = (enabledMods: readonly { name: string }[]) =>
  enabledMods.some((mod) => isMixerPackName(mod.name));
