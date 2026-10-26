const DEC = /^(?:0|[1-9][0-9]{0,2})$/;

/** '192.168.0.1' → 32-bit bigint, or null; leading zeros are rejected */
const parseIPv4 = (s) => {
	const parts = s.split('.');
	if (parts.length !== 4) return null;
	let v = 0n;
	for (const part of parts) {
		if (!DEC.test(part) || +part > 255) return null;
		v = v << 8n | BigInt(+part);
	}
	return v;
};

export { parseIPv4 };
