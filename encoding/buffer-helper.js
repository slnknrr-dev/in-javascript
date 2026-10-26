const isBufClass = BufClass => {
    return typeof BufClass === 'function'
        && ArrayBuffer.isView(new BufClass(BufClass.BYTES_PER_ELEMENT))
        && BufClass.prototype !== DataView.prototype;
};

export { isBufClass }