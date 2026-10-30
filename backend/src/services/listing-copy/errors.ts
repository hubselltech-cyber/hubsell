/** Lỗi nghiệp vụ Sao chép sản phẩm — route trả `status` + message tiếng Việt cho khách. */
export class ListingCopyError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "ListingCopyError";
  }
}
