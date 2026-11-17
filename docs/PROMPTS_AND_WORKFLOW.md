# Prompti và quy trình thực hiện — Vietnamese Tea Stall

Tài liệu này tổng hợp phiên làm việc xây dựng bộ tài sản Quán Trà Đá Vỉa Hè và tích hợp demo Texel Splatting. Nội dung phiên được **tóm lược và biên soạn lại**: các prompt mẫu bên dưới là template tái sử dụng, không phải trích dẫn nguyên văn. Không lưu transcript, ảnh tham chiếu, đường dẫn máy cá nhân, hội thoại ngoài phạm vi dự án hay thông tin bí mật vào kho công khai.

## Yêu cầu ban đầu và thay đổi phạm vi

Yêu cầu đầu tiên tập trung vào tạo tài sản 3D theo ảnh tham chiếu, ưu tiên ghế nhựa đỏ và nón lá làm proof of concept, dùng TopoTopo độc quyền cho hình học/sản phẩm. Yêu cầu đó ban đầu nói không chỉnh renderer trong giai đoạn asset. Sau đó chủ dự án mở rộng và thay đổi phạm vi: làm song song thư viện tài sản và demo Texel Splatting, không chờ asset mới bắt đầu renderer. Thay đổi được ghi nhận trong hợp đồng dự án; không được hiểu yêu cầu ban đầu là cấm tích hợp renderer suốt dự án.

Yêu cầu cốt lõi gồm:

- Dùng ảnh tham chiếu làm chuẩn chính; ưu tiên dáng và nhận diện thật, không tự thêm chi tiết lớn không có căn cứ.
- Giữ graph procedural có thể chỉnh sửa, sinh lặp lại, dùng schema TopoTopo đã tài liệu hóa; không dùng Blender hoặc dịch vụ tạo hình học 3D bên ngoài.
- Xây GLB tĩnh theo hợp đồng: mét, Y-up, triangle mesh, normals, màu vật liệu opaque; mesh nhiều tên/vật liệu và hierarchy được xử lý ở loader.
- Giữ nguyên baseline và kỹ thuật Texel Splatting; chứng minh cùng hình học chạy qua Direct, Cubemap và Splat.
- Bắt đầu tích hợp bằng mock có nhãn rõ ràng để không chặn renderer khi tài sản thật chưa sẵn sàng.
- Kiểm chứng bằng test, build, log và lần chạy thực tế; báo rõ điều gì chưa được thử.

## Mẫu prompt có thể tái sử dụng

### 1. Prompt điều phối nhiều nhánh

```text
Hãy thực hiện dự án [PROJECT] tại [REPOSITORY]. Trước khi sửa, đọc hướng dẫn dự án, hợp đồng giao diện và tình trạng Git hiện tại.

Chia công việc song song theo quyền sở hữu tệp không giao nhau:
- Asset lead: [asset tool] độc quyền cho hình học/tài sản sản xuất; giữ graphs editable và cung cấp GLB, metadata, kiểm tra.
- Demo lead: làm renderer/demo trong [demo directory]; không ghi đè thư mục tài sản hoặc lịch sử của upstream repo lồng nhau.
- Coordinator: chốt asset contract, phối hợp checkpoint, rà soát tích hợp và kiểm chứng.

Mỗi agent/child phải đặt chính xác model `openai-codex/gpt-6-luna` và thinking `high`. Không dùng alias không rõ ràng hoặc `:batch`; kiểm tra trạng thái/đầu ra agent, và khởi chạy lại đúng route nếu model lỗi.

Không để nhánh demo chờ asset: dùng fixture tổng hợp được đánh dấu mock. Chốt contract trước khi tích hợp. Giữ baseline và kỹ thuật lõi. Ghi rõ ownership, dependencies, checkpoints, bằng chứng test và blockers. Không nhận một tính năng là hoàn tất nếu chưa có bằng chứng tương ứng.
```

### 2. Prompt tài sản tham chiếu — template

```text
Tạo [ASSET] cho một quán trà đá vỉa hè Việt Nam từ ảnh tham chiếu đã cung cấp. Ảnh là nguồn sự thật chính. Trước khi dựng, mô tả ngắn silhouette, tỷ lệ, cấu trúc và phần nào chỉ là suy luận. Giữ các lỗ, khoảng trống, đường cong và đặc điểm nhận diện; không tự thêm chi tiết lớn không có căn cứ.

Chỉ dùng TopoTopo để tạo geometry và export sản xuất. Dùng schema/tool thực tế đã tài liệu hóa; không đoán node/parameter. Giữ graph rõ tên, editable, deterministic, có tham số kích thước và vật liệu. Thống nhất mét, Y-up, hướng trước +Z khi có ý nghĩa, origin tại mặt tiếp xúc nền.

Tạo các góc nhìn front/side/top/3-quarter; so sánh với ảnh, nêu khác biệt, chỉnh graph rồi lặp lại. Kiểm tra bounds, normals/winding, vật liệu, triangle count, thành phần tách rời và các giới hạn topology. Export GLB theo contract. Báo chính xác file, kích thước, triangle/material count, kết quả validation và hạn chế; không tuyên bố fidelity hoặc kiểm tra chưa thực hiện.
```

Ghi chú dự án thiết yếu: món nội thất trong ảnh tham chiếu là **ghế thấp không lưng**, không phải ghế có tựa. Nón lá là nón hình nón rộng màu ngà với vành mảnh; phần không nhìn thấy phải ghi rõ là suy luận. Các đạo cụ khác không có ảnh cận cảnh nên tỷ lệ/phom dáng cần được mô tả là giả định, không phải đối chiếu ảnh.

### 3. Prompt renderer GLB và ba đường render — template

```text
Trong [DEMO_REPO], tích hợp GLB tĩnh theo contract [LINK]. Trước hết kiểm tra baseline upstream, lệnh cài đặt/test/build và các giả định scene-specific. Không thay thuật toán Texel Splatting nếu không có lý do và kiểm chứng cụ thể.

Tạo adapter GLB có phạm vi được ghi rõ: hierarchy/TRS, positions/normals, triangle indices, màu base-color opaque, bounds, transforms và nhiều mesh/material. Từ đầu dùng fixture mock nhiều mesh/màu; ghi nhãn mock, không trình bày như tài sản sản xuất.

Render cùng scene qua Direct, Cubemap và Splat bằng các đường code thực tế của từng mode; không che fallback bằng nhãn sai. Khi asset thật sẵn sàng, thay đường dẫn/cấu hình, không viết lại renderer. Kiểm tra mesh/material, transforms, normals, winding, shadows và lỗi console/shader. Ghi test/build/browser evidence theo đúng phạm vi; không khẳng định hỗ trợ browser, GPU, mobile hay deployment nếu chưa thử.
```

### 4. Prompt kiểm tra/handoff

```text
Trước khi kết luận: chạy unit tests, type/check, production build và smoke test phù hợp. Nếu UI/runtime là mục tiêu, chạy demo và thao tác luồng chính khi có thể. So hash asset đã tích hợp với nguồn; tách test fixture khỏi asset sản xuất. Rà soát diff và Git root lẫn repository lồng nhau, loại trừ secrets, local paths, ảnh/asset không được phép phát hành. Báo rõ PASS/FAIL, lệnh và artifact evidence, giới hạn còn tồn tại, điều không kiểm thử, commit và trạng thái remote.
```

## Quy trình đã thực hiện

1. **Chốt mục tiêu, kiểm tra repo và ranh giới xuất bản.** Đọc yêu cầu, tài liệu contract, baseline Texel Splatting, quyền sở hữu tệp, Git root và nested repo. Giữ repo upstream bên trong `web-demo/` tách biệt; không trộn lịch sử Git lồng vào repo root.
2. **Định nghĩa contract chung.** GLB 2.0 không nén, mesh tam giác tĩnh, mét/Y-up, POSITION/NORMAL bắt buộc, base color opaque; không phụ thuộc textures, skinning, animation, meshopt, Draco hoặc GPU instancing cho V1.
3. **Chia việc song song.** Nhánh tài sản sở hữu graphs/exports/previews và chỉ dùng TopoTopo cho geometry sản xuất; nhánh demo sở hữu `web-demo/`. Demo dùng fixture tổng hợp trước khi asset có mặt. Delegate theo các tệp tách biệt, yêu cầu kiểm tra model/thinking chính xác trước khi tạo agents.
4. **Khảo sát baseline và xây adapter.** Giữ lựa chọn baseline upstream riêng; làm loader GLB giới hạn rõ ràng và tổng quát hóa đường render. Chạy test với mock trước, sau đó tích hợp GLB thật khi đạt checkpoint.
5. **Lặp lại tài sản theo ảnh và phản hồi.** So preview nhiều góc với tham chiếu, sửa graph thay vì dừng ở lần sinh đầu. Ví dụ, ống điếu cày được chỉnh để có thân tre dài và bát nhỏ hơn; định hướng trong scene được cập nhật để bát hiện ra ở góc nhìn demo. Tỷ lệ ống/bát là suy luận vì không có ảnh cận cảnh. Không che giấu giới hạn topology còn lại.
6. **Tích hợp theo checkpoint.** Mock GLB → asset kiểm chứng đầu tiên → scene đủ vật thể → kiểm tra ba mode. Đồng bộ asset bằng hash, chạy lại tests/build và QA trên đúng hash cuối cùng.
7. **Đánh giá độc lập và công bố có giới hạn.** Kiểm tra renderer, evidence, license và nhánh xuất bản. Bản GitHub hiện tại chỉ phát hành code và mock: asset sản xuất, graph TopoTopo, ảnh tham chiếu, preview và evidence riêng tư không được đưa lên. Demo không ngụ ý mock là scene sản xuất.

## Sửa sai và bài học

- Agent ban đầu gặp lỗi do định tuyến model `:batch`. Người dùng chỉ rõ lỗi và yêu cầu chạy lại với route chính xác. Ghi nhớ route phải là `openai-codex/gpt-6-luna` với thinking `high`, không dùng alias mơ hồ hay `:batch`; xác minh output thay vì cho rằng agent đã chạy thành công.
- Lúc đầu phạm vi asset-only không cho phép chỉnh renderer, nhưng yêu cầu tiếp theo đã chủ động mở rộng thành hai nhánh làm song song. Contract cập nhật là nguồn sự thật hiện hành.
- Không đợi asset thật để phát triển loader; fixture cho phép tiến triển độc lập nhưng phải luôn mang nhãn mock.
- Một lần render thành công không đủ để chứng minh chất lượng. Sửa dựa trên preview, kiểm tra asset sau export, đồng bộ theo hash và chạy lại QA trên asset mới nhất.
- Không phóng đại kết quả: Direct/Cubemap chưa có output ID/outline như đường Splat; không có picking/selection. Benchmark rAF phản ánh timing callback CPU/display, không phải GPU timestamp. Không có tuyên bố deploy hay hỗ trợ mobile.

## Bằng chứng và phạm vi xác nhận

Các ghi chú/handoff của dự án trong phiên lưu kết quả chi tiết, nhưng là tài liệu nội bộ bị loại khỏi bản phát hành. Chúng ghi nhận 8 GLB TopoTopo, graphs và provenance đã được xác minh; Khronos validator không báo lỗi/cảnh báo cấu trúc; và demo đạt 7/7 tests, check, build tại thời điểm handoff. Native Chrome/WebGPU trên máy Mac đã thử Direct, Cubemap và Splat với asset hash cuối cùng, không có lỗi page/console. Handoff cũng báo khoảng cách tính năng ID/outline đã nêu trên.

Trong lần xác minh cho tài liệu này, chạy `npm test`, `npm run check` và `npm run build` đều thành công; output hiện tại là 6/6 test pass. Build đã đồng bộ 8 GLB từ thư mục asset cục bộ bị ignore vào `web-demo/public/production/`; những file đó không được stage hoặc commit. Đây không phải browser/GPU rerun cho lần cập nhật tài liệu.

Đây là **tóm tắt evidence từ handoff phiên**, không phải cam kết tái lập bởi độc giả từ code-only repository. Trong repo công khai có thể chạy lại các lệnh demo sau; các lệnh này kiểm tra code và mock, không kiểm tra asset sản xuất đã bị loại trừ:

```sh
cd web-demo
npm ci
npm test
npm run check
npm run build
```

Không có kiểm chứng triển khai công khai hoặc mobile; không hàm ý tương thích tất cả trình duyệt/GPU. Các giới hạn asset đầy đủ gồm shell mở, cạnh hở/non-manifold và tiếp xúc/giao cắt giữa một số thành phần; không tuyên bố hình học watertight hoặc hoàn toàn không giao cắt.

## Phạm vi tái sử dụng

Prompt mẫu cho phép dùng lại phương pháp làm việc, không tái cấp phép cho tài sản bị loại trừ. Root `LICENSE` chỉ bao phủ code và tài liệu được phát hành theo phạm vi nêu trong giấy phép; xem [`PUBLICATION.md`](PUBLICATION.md). Không tải transcript phiên, private path, ảnh tham chiếu hay tài sản TopoTopo vào bản public nếu chưa xác nhận quyền và phê duyệt riêng.
