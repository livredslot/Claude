/** Screen layout of the fixed logical game size (scaled to fit any screen). */
export const TILE_PX = 32;
export const GAME_W = 1280;
export const HUD_H = 100;
export const MAP_Y = HUD_H;
export const MAP_H_PX = 20 * TILE_PX;
/** Bottom bar: battle orders + unit legend. */
export const LEGEND_H = 72;
export const GAME_H = HUD_H + MAP_H_PX + LEGEND_H;

export const TEAM_COLORS = [0x3b82f6, 0xef4444] as const;
export const TEAM_DARK = [0x1e3a8a, 0x7f1d1d] as const;
export const TEAM_NAMES = ['Blue', 'Red'] as const;

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
