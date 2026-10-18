export const PLACES = [2, 3] as const;

export type Place = (typeof PLACES)[number];

/** `true` takes the first free place on the blog's home page after the newest post; a number names the place. */
export type Pin = boolean | Place;

/** A pin as the blog's `pinOf` reads the scalar written, given whether it was written plain or quoted. */
export function readPin(text: string, plain: boolean): Pin {
  if (text === "true" || (plain && /^(?:True|TRUE)$/.test(text))) {
    return true;
  }
  return (plain && PLACES.find((place) => String(place) === text)) || false;
}

/** The value written after `pin:`. A draft saved before the field existed has none, which is false. */
export function writtenPin(pin: Pin | undefined): string {
  return typeof pin === "number" ? String(pin) : String(pin === true);
}
