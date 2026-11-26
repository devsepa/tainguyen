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

## Kiểm thử

```powershell
cd ig-tool
npm test
```
