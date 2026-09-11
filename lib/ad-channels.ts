/**
 * Los canales de publicidad que conoce la app y cómo se llaman en pantalla.
 *
 * Vive fuera de las rutas y de los componentes porque lo usan los dos: la
 * API que arma el desglose por plataforma y la tabla que lo muestra. Con la
 * lista duplicada, agregar un canal nuevo dejaba la tabla mostrando el
 * identificador crudo de la base ("tiktok") en vez del nombre.
 */
export const AD_CHANNEL_LABEL: Record<string, string> = {
  mercado_ads: "Mercado Ads",
  meta: "Meta",
  google: "Google Ads",
  tiktok: "TikTok",
};

/** Los canales que el vendedor carga a mano (los que no sincroniza ML). */
export const MANUAL_AD_CHANNELS = ["meta", "google", "tiktok"] as const;

export type ManualAdChannel = (typeof MANUAL_AD_CHANNELS)[number];

export function isManualAdChannel(value: unknown): value is ManualAdChannel {
  return typeof value === "string" && (MANUAL_AD_CHANNELS as readonly string[]).includes(value);
}

/**
 * Un canal que no esté en la lista se muestra tal cual vino de la base, no
 * como "Otro": si mañana ML agrega un canal, es preferible ver el nombre
 * crudo y darse cuenta, a que se mezcle en un cajón de sastre.
 */
export function adChannelLabel(channel: string): string {
  return AD_CHANNEL_LABEL[channel] ?? channel;
}
