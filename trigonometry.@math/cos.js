function cos(x, n = 50) {
    if (!Number.isSafeInteger(n) || n < 0) {
        throw new RangeError("n must be a non-negative safe integer");
    }

    /*
        ------------------------------------------------------------
        Precision budget.

        guard is intentionally generous.

        It covers:
          - fixed-point truncation,
          - Taylor truncation,
          - half-angle reconstruction,
          - Chudnovsky sum truncation,
          - conversion/rounding of input.

        log10(n) extra guard also prevents accumulated
        O(n) rounding errors from eating the guard for huge n.
        ------------------------------------------------------------
    */

    let nd = 1;
    for (let q = n; q >= 10; q = (q / 10) | 0) nd++;

    const guard = 48 + nd;
    const p = n + guard;

    const S = 10n ** BigInt(p);
    const SS = S * S;

    /*
        ------------------------------------------------------------
        Parse decimal x.

        No Number conversion of x.

        Accepted:
            1
            -1
            +1
            1.234
            -0.123456789
            1.2e100
            1.2e-100

        x becomes:

            X / S
        ------------------------------------------------------------
    */

    let s = String(x).trim();

    if (s.length === 0) {
        throw new TypeError("x must not be empty");
    }

    let neg = false;

    if (s.charCodeAt(0) === 45) {
        neg = true;
        s = s.slice(1);
    } else if (s.charCodeAt(0) === 43) {
        s = s.slice(1);
    }

    let e = 0n;
    let eNeg = false;

    let epos = -1;

    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);

        if (c === 101 || c === 69) {
            epos = i;
            break;
        }
    }

    if (epos !== -1) {
        let es = s.slice(epos + 1);
        s = s.slice(0, epos);

        if (es.charCodeAt(0) === 45) {
            eNeg = true;
            es = es.slice(1);
        } else if (es.charCodeAt(0) === 43) {
            es = es.slice(1);
        }

        if (!es.length) {
            throw new TypeError("invalid exponent");
        }

        for (let i = 0; i < es.length; i++) {
            const c = es.charCodeAt(i) - 48;

            if (c < 0 || c > 9) {
                throw new TypeError("invalid exponent");
            }

            e = e * 10n + BigInt(c);
        }

        if (eNeg) e = -e;
    }

    let dot = -1;

    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) === 46) {
            dot = i;
            break;
        }
    }

    let frac = 0;

    if (dot === -1) {
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);

            if (c < 48 || c > 57) {
                throw new TypeError("invalid decimal");
            }
        }
    } else {
        frac = s.length - dot - 1;

        for (let i = 0; i < s.length; i++) {
            if (i === dot) continue;

            const c = s.charCodeAt(i);

            if (c < 48 || c > 57) {
                throw new TypeError("invalid decimal");
            }
        }

        s = s.slice(0, dot) + s.slice(dot + 1);
    }

    if (!s.length) s = "0";

    let X = BigInt(s);

    /*
        decimal value:

            X * 10^(e-frac)

        convert to fixed point S.
    */

    const shift = e + BigInt(p - frac);

    if (shift >= 0n) {
        X *= 10n ** shift;
    } else {
        const d = 10n ** (-shift);

        /*
            Round input to working precision instead of
            blindly truncating it.
        */
        const q = X / d;
        const r = X % d;

        X = q;

        if (r * 2n >= d) {
            X++;
        }
    }

    if (neg) X = -X;

    /*
        cos(0) is worth special-casing.

        This also avoids calculating π for the overwhelmingly
        common trivial input.
    */

    if (X === 0n) {
        if (n === 0) return "1";

        let z = "0";

        while (z.length < n) z += "0";

        return "1." + z;
    }

    /*
        ------------------------------------------------------------
        Fast path:

        π > 3.

        Therefore if |x| <= 3, x is already safely inside
        [-π, π], so no π calculation / modulo is necessary.

        This is a surprisingly important optimization:
        cos("1", 10000) does NOT need to calculate π at all.
        ------------------------------------------------------------
    */

    let ax = X < 0n ? -X : X;

    /*
        3*S
    */

    const THREE = 3n * S;

    /*
        ------------------------------------------------------------
        π only when required.

        Chudnovsky:

        π =
          426880 * sqrt(10005)
          /
          Σ ...

        ~14 decimal digits / term.

        We deliberately use fixed-point throughout.
        ------------------------------------------------------------
    */

    let PI = 0n;

    if (ax > THREE) {
        const A = 13591409n;
        const B = 545140134n;
        const C = 640320n;

        const C3 = C * C * C;

        /*
            Number of terms.

            Chudnovsky gives slightly more than
            14 decimal digits per term.

            +2 is deliberate overkill.
        */

        const terms = ((p + 13) / 14) + 2;

        /*
            sqrt(10005) * S

            Newton iteration.

            101*S is an upper bound because
            sqrt(10005) < 101.
        */

        const Z = 10005n * SS;

        let root = 101n * S;

        while (true) {
            const next = (root + Z / root) >> 1n;

            if (next >= root) break;

            root = next;
        }

        /*
            Chudnovsky sum.

            We maintain factorials incrementally:

              (6k)!
              (3k)!
              k!

            instead of recalculating them.
        */

        let f6 = 1n;
        let f3 = 1n;
        let f1 = 1n;

        let cpow = 1n;

        let sum = 0n;

        for (let k = 0; k < terms; k++) {
            if (k !== 0) {
                const a6 = 6 * k;

                /*
                    f6 *= (6k-5)...(6k)
                */

                f6 *= BigInt(a6 - 5);
                f6 *= BigInt(a6 - 4);
                f6 *= BigInt(a6 - 3);
                f6 *= BigInt(a6 - 2);
                f6 *= BigInt(a6 - 1);
                f6 *= BigInt(a6);

                /*
                    f3 *= (3k-2)(3k-1)(3k)
                */

                const a3 = 3 * k;

                f3 *= BigInt(a3 - 2);
                f3 *= BigInt(a3 - 1);
                f3 *= BigInt(a3);

                f1 *= BigInt(k);

                cpow *= C3;
            }

            /*
                term =
                  (6k)! (A + Bk)
                  /
                  ((3k)! (k!)^3 C^(3k))

                multiplied by S because sum is fixed point.
            */

            const numerator =
                f6 *
                (A + B * BigInt(k)) *
                S;

            const denominator =
                f3 *
                f1 *
                f1 *
                f1 *
                cpow;

            const term = numerator / denominator;

            if (k & 1) {
                sum -= term;
            } else {
                sum += term;
            }

            /*
                Once the fixed-point term disappears,
                all following terms are below our working unit.
            */

            if (term === 0n) break;
        }

        /*
            π_fixed =
              426880 * sqrt(10005) * S / sum

            root is already sqrt(10005)*S.
        */

        PI = (426880n * root * S) / sum;

        /*
            Range reduction:
                x mod 2π
        */

        const TWO_PI = PI << 1n;

        X %= TWO_PI;

        if (X > PI) {
            X -= TWO_PI;
        } else if (X < -PI) {
            X += TWO_PI;
        }

        ax = X < 0n ? -X : X;

        /*
            cos(-x) = cos(x)
        */

        if (X < 0n) X = -X;
    }

    /*
        ------------------------------------------------------------
        Half-angle reduction.

        Instead of Taylor at x ≈ π/2 or π, do:

            x -> x/2 -> x/4 -> ...

        until x <= 1/8.

        Then calculate cos(x) there.

        Reconstruct:

            cos(2x) = 2cos²(x) - 1

        This dramatically reduces the number of Taylor terms.
        ------------------------------------------------------------
    */

    let halves = 0;

    const LIMIT = S >> 3n; // S / 8

    while (X > LIMIT) {
        /*
            Fixed point division by 2.

            Round to nearest instead of truncating.
        */

        X = (X + 1n) >> 1n;
        halves++;
    }

    /*
        ------------------------------------------------------------
        Taylor:

          cos(x) =
              1
            - x²/2!
            + x⁴/4!
            - ...

        X / S is x.

        Instead of:

            term = term * X² / S
            term /= denominator

        do ONE division:

            term =
              term * X²
              /
              (S² * denominator)

        That matters a lot for BigInt.
        ------------------------------------------------------------
    */

    let result = S;
    let term = S;

    const x2 = X * X;

    let k = 1n;

    while (true) {
        const denominator =
            SS *
            ((k << 1n) - 1n) *
            (k << 1n);

        term = (term * x2) / denominator;

        if (term === 0n) break;

        if (k & 1n) {
            result -= term;
        } else {
            result += term;
        }

        k++;
    }

    /*
        ------------------------------------------------------------
        Undo half-angle reduction.

            c <- 2c² - 1

        Again, ONE division per step.
        ------------------------------------------------------------
    */

    while (halves--) {
        result = ((result * result) << 1n) / S - S;
    }

    /*
        ------------------------------------------------------------
        Final decimal rounding.

        result is:

            result / S

        S = 10^(n + guard)

        Drop guard digits and round to n places.
        ------------------------------------------------------------
    */

    let negativeResult = result < 0n;

    if (negativeResult) result = -result;

    const G = 10n ** BigInt(guard);

    let q = result / G;
    const r = result % G;

    /*
        Round half-up.
    */

    if ((r << 1n) >= G) {
        q++;
    }

    /*
        Avoid "-0.000..."
    */

    if (q === 0n) {
        negativeResult = false;
    }

    if (n === 0) {
        return (negativeResult ? "-" : "") + q.toString();
    }

    let out = q.toString();

    /*
        q represents an integer with n fractional digits.
    */

    while (out.length <= n) {
        out = "0" + out;
    }

    const cut = out.length - n;

    return (
        (negativeResult ? "-" : "") +
        out.slice(0, cut) +
        "." +
        out.slice(cut)
    );
}