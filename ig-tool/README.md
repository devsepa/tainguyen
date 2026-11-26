# Local Instagram Registration Tool (`ig-tool`)

Công cụ chạy cục bộ trên Windows (Node.js 22+ & Playwright) để tạo từng tài khoản Instagram với trình duyệt có giao diện, kiểm tra proxy (HTTP / SOCKS5 có xác thực qua relay cục bộ), đọc OTP tự động (Tempamail có Access Key) hoặc nhập OTP thủ công, và lưu kết quả vào kho hiện tại.

## Yêu cầu

- Windows với **Node.js 22+**
- Trình duyệt Chromium của Playwright (cài một lần):
  ```powershell
  cd ig-tool
  npm ci
  npm run install-browser
  ```

## Cách chạy

1. **Mở nhanh dạng App (khuyên dùng):** Bấm đúp vào file `ig-tool\IG-Tool.bat` — cửa sổ app riêng sẽ mở thẳng tại mục **Tạo IG** (`http://127.0.0.1:4312/#tao-ig`). Khi muốn tắt hoàn toàn tool, chỉ cần đóng cửa sổ dòng lệnh đi kèm.
2. Hoặc chạy bằng PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\ig-tool\start.ps1 -AppMode
   ```
3. Chọn email từ kho, nhập tên, username, mật khẩu, ngày sinh và proxy (tuỳ chọn `host:port:user:pass`).
4. Bấm **Kiểm tra proxy** để xác định giao thức (`HTTP` / `SOCKS5`) và IP đầu ra, sau đó bấm **Bắt đầu tạo tài khoản**.
5. Khi hoàn tất và xác nhận đúng username đang đăng nhập, bấm **Lưu vào kho**.

Trên Mobile, sau username tool bấm **Tiếp**, xử lý màn **Tôi đồng ý** rồi chờ
tài khoản đăng nhập được xác minh. Nút **Xác nhận** trong bảng tiến trình chỉ xuất
hiện sau khi xác minh thành công; bấm nút đó để lưu vào kho. Bấm đồng ý hoặc thấy
trang đang tải chưa được coi là đăng ký thành công. Nếu username chưa chuyển bước,
tool thử lại Tiếp một lần mà không gõ lại username; không tự bấm đồng ý lặp lại.

## Kiểm thử

### Khi Mobile báo mã OTP không hợp lệ

Mobile dùng profile **Chrome Android (Pixel 7)** của Playwright, cùng engine
Chromium với trình duyệt đang chạy. Bản cũ gán User-Agent Safari/iPhone cho
Chromium và ghi đè thêm qua CDP; bản mới bỏ cấu hình trộn đó và bỏ CSS zoom của
trang ở chế độ mobile. Đây là cấu hình giả lập Chrome mobile, không phải Safari
hay điện thoại thật. Việc đổi profile sửa sự khác biệt đã tìm thấy so với Chrome
DevTools mobile; cần kiểm tra phiên Instagram thực tế để xác nhận lỗi OTP hết.

Luồng Mobile Instagram bắt đầu từ trang chủ và bấm nút hoặc liên kết Đăng ký mà
trang hiển thị. Nếu vào bước số điện thoại, tool bấm **Đăng ký bằng email**,
giữ nguyên browser context/proxy đến bước OTP. Tool không mở thẳng
`/accounts/signup/email/` nữa. Thay đổi này khớp đường đi thủ công người dùng đã
xác nhận hoạt động với cùng proxy; việc Instagram chấp nhận OTP vẫn cần xác nhận
trên phiên thực tế.

Tool sẽ tạm dừng và ngừng tự gửi mã khi trang xác nhận báo mã sai hoặc hết hạn.
Phần tiến trình hiển thị nguồn mã, ID thư và thời điểm gửi để đối chiếu. Không coi
việc bấm Tiếp hoặc gửi mã là đăng ký thành công.

Mục **Phản hồi đăng ký** ghi tối đa 12 yêu cầu gần nhất trong bộ nhớ và hiển thị
4 yêu cầu cuối, gồm nhóm thao tác, giờ, HTTP status, trạng thái `ok`/`fail` và mã
lỗi chuẩn nếu có. Phần này quan sát được cả thao tác nhập mã trực tiếp trong
trình duyệt. Không thu thập nội dung yêu cầu, OTP, mật khẩu, URL có tham số hoặc
cookie. HTTP 200 vẫn có thể đi kèm trạng thái `fail`; phản hồi Bloks không có mã
lỗi chuẩn chỉ hiển thị HTTP status, không suy đoán nguyên nhân.

Nếu tự nhập trực tiếp vẫn bị từ chối, chưa thể quy nguyên nhân cho nút gửi của
tool. Trong chính cửa sổ đang chờ xác nhận, yêu cầu một mã mới, chờ đúng thư gửi
đến email đang hiển thị rồi nhập trực tiếp. Không dùng lại mã từ phiên Desktop,
mã trước lần yêu cầu gửi lại, hoặc thay cửa sổ/phiên giữa chừng. Nếu vẫn lỗi, giữ
phiên đó và đối chiếu chi tiết lần xác nhận; không tự động gửi lặp lại.

Sau khi cập nhật code, dừng phiên hiện tại và khởi động lại `IG-Tool.bat` để tiến
trình Node nạp bản mới. Các kiểm thử dùng trang giả lập, không chứng minh rằng
Instagram sẽ chấp nhận một phiên đăng ký thực tế.

```powershell
cd ig-tool
npm test
```
