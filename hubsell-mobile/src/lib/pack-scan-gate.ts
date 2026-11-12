/**
 * CỬA CHỐNG BẮN LẶP của màn Quét đóng gói (05/11/2026, viết lại 12/11/2026) — hàm thuần,
 * không React, không đồng hồ thật (mọi mốc thời gian truyền vào) để test được bằng node.
 *
 * Vì sao cần: màn quét đóng gói quét LIÊN TỤC, không bấm gì giữa hai kiện. Camera bắn
 * ~10 lượt đọc mỗi giây cho mỗi mã đang nằm trong khung, và tem của sàn thường có 2–3
 * mã vạch (mã vận đơn, mã đơn, mã phân tuyến / QR). Không có cửa này thì một kiện gọi
 * máy chủ hàng chục lần, kêu "đã quét rồi" ngay sau khi kêu "đã ghi", hoặc kêu "không
 * thấy mã" vì đọc trúng mã phân tuyến của chính tem vừa quét xong.
 *
 * Ý NIỆM GỐC — "LƯỢT ĐƯA KIỆN": một mã vắng khỏi khung đủ REARM_MS rồi xuất hiện lại là
 * một lượt đưa kiện MỚI, và mỗi lượt đưa kiện mã đó ĐƯỢC HỎI MÁY CHỦ ĐÚNG MỘT LẦN (cờ
 * `armed`). Cờ chỉ hạ khi mã thật sự được gửi đi hoặc khi mã vạch khác của CÙNG ĐƠN đã lo
 * xong lượt này — không hạ vì "vừa thấy mã cách đây chưa tới 2 giây".
 *
 * Bản 05/11 xét luật 2 bằng "lần thấy gần nhất", mà lần thấy được làm mới cả ở lượt đọc
 * BỊ TỪ CHỐI (máy đang bận). Hệ quả anh Trung gặp trên máy thật 12/11:
 *   · đưa lại kiện đúng lúc đang có lượt gọi khác → mã bị coi là "đã xử lý, còn trong
 *     khung" mãi → không gửi, không kêu: màn hình ĐƠ;
 *   · quét lại kiện mà camera đọc mã phân tuyến trước → mã phân tuyến chiếm lượt gọi,
 *     mã vận đơn bị khóa như trên → chỉ còn câu "không thấy đơn" (đơn hủy quét lần hai);
 *   · hai mã vạch đã biết của cùng một đơn có thể khóa chéo nhau (luật 3) khi cùng trở lại.
 *
 * LUẬT (docs/MOBILE-DAI-TU-DON-HANG-KHO.md mục 3):
 *   1. Mỗi lúc MỘT lượt gọi — đang gọi thì mã mới chờ, và VẪN GIỮ quyền được gửi của lượt
 *      đưa kiện này.
 *   2. Mã đã hỏi máy chủ trong lượt đưa kiện này → không hỏi lại khi còn trong khung.
 *   3. Mã vạch khác của tem vừa RA ĐƠN trong lượt này (đang gọi, hoặc đã xong và còn
 *      trong khung) → bỏ qua. Mã đã biết là của cùng đơn thì coi như đã xong lượt.
 *   4. Mã từng KHÔNG ra đơn (mã phân tuyến) trở lại khung → nhường COMPANION_MS cho mã
 *      vận đơn của cùng tem đi trước; hết thời gian nhường mà không có mã nào ra đơn thì
 *      mới hỏi lại máy chủ.
 *   5. (ở màn quét, theo `resolved()`) mã vạch khác của tem ĐANG trong khung → im; kiện
 *      đưa vào lần nữa → luôn báo ("đã quét rồi" / "đơn đã hủy") — không bao giờ im lặng.
 */

/** Mã phải vắng khung chừng này mới tính là đưa kiện vào lần nữa. Mặc định tự chọn; web chặn lặp 2 giây. */
export const REARM_MS = 2000;
/** Hai mã thấy cách nhau trong khoảng này coi là cùng một tem. Mặc định tự chọn, chỉnh sau khi thử tem thật. */
export const COMPANION_MS = 600;
/** Lượt gọi hỏng vì mạng: thử lại sau chừng này dù mã vẫn nằm trong khung. Mặc định tự chọn. */
export const NETWORK_RETRY_MS = 2500;

export type GateVerdict =
  /** Gửi mã này lên máy chủ. */
  | "fire"
  /** Luật 1: đang có lượt gọi. */
  | "busy"
  /** Luật 2: mã đã xử lý trong lượt đưa kiện này. */
  | "same"
  /** Luật 3: mã vạch khác của tem vừa ra đơn. */
  | "companion"
  /** Luật 4: mã từng không ra đơn, đang nhường mã vận đơn của cùng tem. */
  | "hold"
  /** Vừa hỏng mạng với mã này, chưa tới giờ thử lại. */
  | "cooldown";

/**
 * Máy chủ vừa nhận ra đơn bằng mã này — so với những gì phiên quét đã biết:
 *   first  = đơn này lần đầu gặp trong phiên;
 *   alias  = mã vạch KHÁC của tem đang nằm trong khung: một mã của đúng đơn này vừa được
 *            hỏi máy chủ và còn thấy trong REARM_MS gần nhất → cùng một lượt đưa kiện,
 *            màn quét im (đã báo rồi);
 *   repeat = đơn đã gặp và KHÔNG còn mã nào của nó trong khung → người gói đưa kiện vào
 *            lần nữa (dù camera đọc trúng mã vạch nào của tem) → màn quét phải báo.
 */
export type ResolveKind = "first" | "alias" | "repeat";

type Outcome = "order" | "unknown" | "network";

interface CodeState {
  /** Lần gần nhất camera THẤY mã — làm mới ở mọi lượt đọc. */
  lastSeen: number;
  /** Lúc bắt đầu lượt đưa kiện hiện tại của mã. */
  presentedAt: number;
  /** Lượt đưa kiện này mã còn quyền được hỏi máy chủ. */
  armed: boolean;
  outcome?: Outcome;
  /** Đơn mà mã này ra (khi outcome = order). */
  orderId?: string;
  /** Mốc được thử lại của mã hỏng mạng. */
  retryAt?: number;
}

export class PackScanGate {
  private codes = new Map<string, CodeState>();
  /** Các đơn đã gặp trong phiên → để phân biệt first / alias. */
  private orders = new Set<string>();
  private inFlight: string | null = null;

  /** Camera vừa đọc được `code` lúc `now` → có gửi máy chủ không. */
  admit(code: string, now: number): GateVerdict {
    let st = this.codes.get(code);
    if (!st) {
      st = { lastSeen: now, presentedAt: now, armed: true };
      this.codes.set(code, st);
    } else {
      // Vắng đủ lâu rồi mới thấy lại = lượt đưa kiện mới → trả lại quyền hỏi máy chủ.
      if (now - st.lastSeen >= REARM_MS) {
        st.armed = true;
        st.presentedAt = now;
      }
      st.lastSeen = now;
    }

    if (st.outcome === "network") {
      // Kiện CHƯA được ghi: tự thử lại theo nhịp, kể cả khi mã vẫn nằm yên trong khung.
      if (now < (st.retryAt ?? 0)) return "cooldown";
    } else if (st.outcome && !st.armed) {
      return "same";
    }

    for (const [other, o] of this.codes) {
      if (other === code) continue;
      // "Đã lo xong lượt này": đang được gọi, hoặc đã gọi xong (hết armed) và còn trong khung.
      const handling = other === this.inFlight || (o.outcome === "order" && !o.armed);
      if (!handling) continue;
      // Mã vạch đã biết của CÙNG ĐƠN: lượt này coi như xong, không hỏi máy chủ lần nữa.
      if (st.orderId && o.orderId === st.orderId && now - o.lastSeen < REARM_MS) {
        st.armed = false;
        return "same";
      }
      if (o.outcome === "order" && !o.armed && now - o.lastSeen < COMPANION_MS) return "companion";
    }

    // Luật 4: mã phân tuyến trở lại khung → chờ mã vận đơn của cùng tem một nhịp.
    if (st.outcome === "unknown" && now - st.presentedAt < COMPANION_MS) return "hold";

    if (this.inFlight !== null) return "busy";
    this.inFlight = code;
    return "fire";
  }

  /** Máy chủ nhận ra một đơn (ghi được / đã quét / bị chặn) lúc `now`. */
  resolved(code: string, orderId?: string, now: number = Date.now()): ResolveKind {
    let kind: ResolveKind = "first";
    if (orderId !== undefined && this.orders.has(orderId)) {
      kind = "repeat";
      for (const [other, o] of this.codes) {
        if (other === code || o.orderId !== orderId || o.outcome !== "order" || o.armed) continue;
        if (now - o.lastSeen < REARM_MS) {
          kind = "alias";
          break;
        }
      }
    }
    if (orderId !== undefined) this.orders.add(orderId);
    this.finish(code, "order").orderId = orderId;
    return kind;
  }

  /** Máy chủ không thấy đơn nào với mã này (404) hoặc mã khớp nhiều đơn (409). */
  unknown(code: string): void {
    this.finish(code, "unknown").orderId = undefined;
  }

  /** Lượt gọi hỏng (mất mạng, quá giờ, máy chủ lỗi) — kiện CHƯA được ghi, cho thử lại. */
  networkFailed(code: string, now: number): void {
    this.finish(code, "network").retryAt = now + NETWORK_RETRY_MS;
  }

  /** Gõ tay: người dùng chủ động gửi, không qua luật 2–4 nhưng vẫn giữ luật 1. */
  admitManual(code: string): boolean {
    if (this.inFlight !== null) return false;
    this.inFlight = code;
    return true;
  }

  private finish(code: string, o: Outcome): CodeState {
    if (this.inFlight === code) this.inFlight = null;
    let st = this.codes.get(code);
    if (!st) {
      // Mã gõ tay chưa từng qua camera: coi như chưa từng thấy trong khung.
      st = { lastSeen: -Infinity, presentedAt: -Infinity, armed: false };
      this.codes.set(code, st);
    }
    st.outcome = o;
    st.armed = false; // đã hỏi máy chủ xong cho lượt đưa kiện này
    this.prune();
    return st;
  }

  /** Ca dài quét vài nghìn kiện — bỏ bớt mã cũ, giữ bộ nhớ phẳng. */
  private prune(): void {
    if (this.codes.size <= 400) return;
    const keep = [...this.codes.entries()].sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, 200);
    this.codes = new Map(keep);
    // Đơn chỉ dùng để phân biệt first / alias — giữ những đơn còn mã trong bảng.
    this.orders = new Set(keep.map(([, s]) => s.orderId).filter((id): id is string => !!id));
  }
}
