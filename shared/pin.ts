export const PLACES = [2, 3] as const;

export type Place = (typeof PLACES)[number];

export type Pin = boolean | Place;

const NUMBER = /^(?:[-+]?(?:\.\d+|\d+(?:\.\d*)?)(?:[eE][-+]?\d+)?|0x[\da-fA-F]+|0o[0-7]+)$/;

export function readPin(text: string, plain: boolean): Pin {
  if (text === "true" || (plain && /^(?:True|TRUE)$/.test(text))) {
    return true;
  }
  return (plain && NUMBER.test(text) && PLACES.find((place) => place === Number(text))) || false;
}

export function writtenPin(pin: Pin | undefined): string {
  return typeof pin === "number" ? String(pin) : String(pin === true);
}
