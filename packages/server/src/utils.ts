// https://github.com/wevm/viem/blob/f43388495e6f87147108ea101b6083213c5699c0/src/utils/stringify.ts#L5
export const stringify: typeof JSON.stringify = (value, replacer, space) =>
  JSON.stringify(
    value,
    (key, value_) => {
      const value = typeof value_ === 'bigint' ? value_.toString() : value_;
      return typeof replacer === 'function' ? replacer(key, value) : value;
    },
    space,
  );
