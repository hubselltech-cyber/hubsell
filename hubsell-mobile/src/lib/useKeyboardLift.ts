import { useEffect, useState, type RefObject } from "react";
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type View } from "react-native";

/**
 * BÀN PHÍM CHE LỚP NỔI BÁM ĐÁY (anh Trung 04/10, máy Android thật): ô nhập tay và hộp
 * kết quả của màn quét là lớp NỔI (absolute bottom 0) nên padding của
 * KeyboardAvoidingView không đẩy được chúng. Tự đo: phần đáy của `rootRef` nằm dưới mép
 * trên bàn phím bao nhiêu thì nâng các lớp nổi lên bấy nhiêu. Đo theo vị trí thật trên
 * màn nên đúng cả khi màn quét nằm trên thanh tab lẫn khi phủ kín.
 *
 * Tách từ ScanScreen 05/11/2026 để màn Quét đóng gói dùng chung. `rootRef` phải gắn vào
 * View có `collapsable={false}` (Android gộp view rỗng → đo ra 0).
 *
 * 26/11/2026 — dùng thêm cho màn KHÔNG nằm sát mép trên màn hình (Trợ lý Hubsell mở dạng
 * tờ trượt của iOS): KeyboardAvoidingView tính phần bị che theo tọa độ trong khung cha nên
 * thiếu đúng khoảng tờ trượt cách mép trên → ô nhập vẫn bị bàn phím che. Đo trong cửa sổ
 * thì không lệch. `animate`: trên iOS cho phần nâng trượt cùng nhịp bàn phím (cùng cách
 * KeyboardAvoidingView làm); mặc định tắt — ba màn quét giữ nguyên hành vi cũ.
 */
export function useKeyboardLift(
  rootRef: RefObject<View | null>,
  opts: { animate?: boolean } = {}
): {
  /** Số px cần nâng lớp nổi lên. 0 khi bàn phím đóng. */
  kbLift: number;
  kbOpen: boolean;
} {
  const [kbLift, setKbLift] = useState(0);
  const [kbOpen, setKbOpen] = useState(false);
  const animate = opts.animate === true && Platform.OS === "ios";
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    /** Cho lần đổi bố cục kế tiếp trượt theo đúng thời lượng + đường cong của bàn phím. */
    const glide = (e: KeyboardEvent | undefined) => {
      if (!animate || !e?.duration) return;
      LayoutAnimation.configureNext({
        duration: Math.max(e.duration, 10),
        update: {
          duration: Math.max(e.duration, 10),
          type: (e.easing && LayoutAnimation.Types[e.easing]) || "keyboard",
        },
      });
    };
    const show = Keyboard.addListener(showEvt, (e) => {
      setKbOpen(true);
      const kbTop = e.endCoordinates.screenY;
      rootRef.current?.measureInWindow((_x, y, _w, h) => {
        glide(e);
        setKbLift(Math.max(0, Math.round(y + h - kbTop)));
      });
    });
    const hide = Keyboard.addListener(hideEvt, (e) => {
      glide(e);
      setKbOpen(false);
      setKbLift(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [rootRef, animate]);
  return { kbLift, kbOpen };
}
