const COLON = /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/;
const DASH = /^[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}$/;
const DOT = /^[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}$/;
const BARE = /^[0-9a-fA-F]{12}$/;

/** EUI-48 → 48-bit bigint, or null.
 *  'AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', 'aabb.ccdd.eeff', 'aabbccddeeff' — any case */
const parseMac = (s) => {
	if (typeof s != 'string') return null;
	if (!COLON.test(s) && !DASH.test(s) && !DOT.test(s) && !BARE.test(s)) return null;
	return BigInt('0x' + s.replace(/[:.-]/g, ''));
};

export { parseMac };
