"use client";
import { useEffect, useMemo, useState } from "react";
import { botCommandSchema } from "../../../packages/core/src/control";
import type {
  CommandRow,
  Control,
  DeviceState,
  Receipt,
  Run,
  Snapshot,
} from "../lib/types";
import { download, jobNames, time } from "../lib/utils";
import { Empty, EmptyRow, Icon, Note, Panel, Pill } from "./ui";
export default function ControlView({
  account,
  device,
  deviceState,
  commands,
  receipt,
  send,
  run,
  busy,
  fresh,
}: {
  account: string;
  device: string;
  deviceState?: DeviceState;
  commands: CommandRow[];
  receipt?: Receipt;
  send: (command: unknown) => Promise<string>;
  run: Run;
  busy: boolean;
  fresh: boolean;
}) {
  const [target, setTarget] = useState(""),
    [action, setAction] = useState("click"),
    [value, setValue] = useState(""),
    [option, setOption] = useState(""),
    [checked, setChecked] = useState("true"),
    [key, setKey] = useState("Enter"),
    [file, setFile] = useState<File | null>(null),
    [destination, setDestination] = useState("campaigns"),
    [customUrl, setCustomUrl] = useState(""),
    [levels, setLevels] = useState(["campaigns", "adsets", "ads"]),
    [steps, setSteps] = useState(5);
  const snapshot = useMemo(() => {
    const choices = [
      deviceState?.state.ui?.snapshot,
      receipt?.result?.ui?.snapshot,
    ].filter((s): s is Snapshot => !!s);
    return choices.sort(
      (a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at),
    )[0];
  }, [deviceState?.state.ui, receipt]);
  useEffect(() => {
    setTarget("");
    setFile(null);
  }, [snapshot?.snapshot_id]);
  const control = snapshot?.controls.find((c) => c.id === target);
  const lease = deviceState?.state.control;
  const canWrite =
    fresh &&
    lease?.account === account &&
    lease.expires_at > Date.now() &&
    lease.remaining > 0;
  const pending = commands.some(
    (c) => c.status === "pending" && c.command.command.startsWith("ui."),
  );
  const job = deviceState?.state.job;
  const reading = job?.status === "running";
  const uiBusy = busy || pending || reading || !device;
  const approval = deviceState?.state.approval;
  const review =
    receipt?.result?.ui?.outcome === "awaiting_local_review"
      ? receipt
      : undefined;
  const approved =
    !!canWrite &&
    !!review?.result?.ui?.approval_id &&
    approval?.id === review.result.ui.approval_id &&
    approval.approved &&
    approval.expires_at > Date.now();
  const screenshot = receipt?.result?.ui?.data_url;
  const act = (command: unknown) =>
    void run("command", async () => {
      await send(botCommandSchema.parse(command));
    });
  function select(c: Control) {
    setTarget(c.id);
    setAction(
      c.type === "file"
        ? "upload"
        : c.tag === "select"
          ? "select"
          : ["checkbox", "radio", "switch"].includes(c.role)
            ? "check"
            : ["input", "textarea"].includes(c.tag) || c.role === "textbox"
              ? "fill"
              : "click",
    );
    setValue(c.value ?? "");
    setOption(c.options?.[0]?.value ?? "");
  }
  async function submit() {
    if (!snapshot || !target)
      throw new Error("กดอ่านหน้าปัจจุบันแล้วเลือกองค์ประกอบก่อน");
    if (!canWrite) throw new Error("เปิดโหมดควบคุมจาก popup ของ Extension ก่อน");
    const common = { snapshot_id: snapshot.snapshot_id, target };
    let commandAction: unknown;
    if (action === "fill") commandAction = { type: action, ...common, value };
    else if (action === "select") {
      if (!option)
        throw new Error("เมนูนี้ให้ใช้การคลิกเปิด แล้วเลือกตัวเลือกจากภาพรวมหน้าใหม่");
      commandAction = { type: action, ...common, value: option };
    } else if (action === "check")
      commandAction = { type: action, ...common, checked: checked === "true" };
    else if (action === "press")
      commandAction = { type: action, ...common, key };
    else if (action === "upload") {
      if (!file) throw new Error("เลือกไฟล์ก่อน");
      if (file.size > 5_000_000) throw new Error("ไฟล์ใหญ่เกิน 5 MB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 16384)
        binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      commandAction = {
        type: action,
        ...common,
        filename: file.name,
        mime_type: file.type,
        base64: btoa(binary),
      };
    } else commandAction = { type: "click", ...common };
    await send(
      botCommandSchema.parse({ command: "ui.action", action: commandAction }),
    );
  }
  return (
    <>
      <div className="toolbar">
        <div className="button-group">
          <button
            className="primary"
            disabled={uiBusy}
            onClick={() =>
              act({ command: "ui.action", action: { type: "inspect" } })
            }
          >
            <Icon name="scan" />
            อ่านหน้าปัจจุบัน
          </button>
          <button
            className="secondary"
            disabled={uiBusy}
            onClick={() => act({ command: "ui.focus" })}
          >
            เปิดแท็บที่เชื่อมต่อ
          </button>
          <button
            className="secondary"
            disabled={uiBusy}
            onClick={() => act({ command: "ui.screenshot" })}
          >
            <Icon name="image" />
            ภาพหน้าจอ
          </button>
        </div>
        <Pill kind={canWrite ? "success" : "neutral"}>
          {canWrite ? `ควบคุมได้อีก ${lease!.remaining} คำสั่ง` : "โหมดอ่านข้อมูล"}
        </Pill>
      </div>
      <Note>
        {canWrite
          ? `โหมดควบคุมหมดเวลา ${time(lease!.expires_at)} • การแก้ฟอร์มอาจบันทึกข้อมูลจริงทันที`
          : "การคลิก กรอก หรืออัปโหลด ต้องเปิดโหมดควบคุมจาก popup ของ Extension ก่อน"}
      </Note>
      {reading ? (
        <div className="notice-error">
          กำลังรวบรวมตารางอยู่ กรุณาพักงานด้านล่างก่อนควบคุมหน้าเว็บ
        </div>
      ) : null}
      {pending ? (
        <p className="inline-note">
          ส่งคำสั่งแล้ว กำลังรอ Extension อ่านหรือทำงานบนหน้าเว็บ…
        </p>
      ) : null}
      {review ? (
        <div className="approval-panel">
          <h2>มีคำสั่งรอตรวจใน Extension</h2>
          <p>
            {approved
              ? "อนุมัติใน Extension แล้ว กดปุ่มด้านล่างเพื่อส่งคำสั่งเดิมต่อ"
              : "เปิด popup ของ Extension เพื่อตรวจบัญชี คำสั่ง และอนุมัติครั้งเดียว"}
          </p>
          <button
            className="primary"
            disabled={!approved || uiBusy}
            onClick={() =>
              act({
                ...review.command,
                approval_id: review.result?.ui?.approval_id,
              })
            }
          >
            ดำเนินคำสั่งที่อนุมัติแล้ว
          </button>
        </div>
      ) : null}
      <div className="control-grid">
        <Panel
          title={snapshot?.title || "หน้าที่ Extension มองเห็น"}
          subtitle={
            snapshot
              ? `${time(snapshot.captured_at)} • ${snapshot.account_verified ? "บัญชีตรงกับ URL" : "URL ยังไม่ระบุบัญชี อ่านได้อย่างเดียว"}`
              : "ยังไม่มีภาพรวมหน้าเว็บ"
          }
          action={
            <button
              className="icon-button"
              disabled={!snapshot}
              aria-label="ส่งออกภาพรวมหน้า"
              onClick={() =>
                download(
                  JSON.stringify(snapshot, null, 2),
                  "meta-page-observation.json",
                )
              }
            >
              <Icon name="download" />
            </button>
          }
        >
          {snapshot ? (
            <>
              <div className="table-scroll controls-table">
                <table>
                  <thead>
                    <tr>
                      <th>องค์ประกอบ</th>
                      <th>ชนิด</th>
                      <th>สถานะ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.controls.length ? (
                      snapshot.controls.map((c) => (
                        <tr
                          key={c.id}
                          className={target === c.id ? "selected" : ""}
                        >
                          <td>
                            <strong>{c.label || "องค์ประกอบไม่มีชื่อ"}</strong>
                            {c.value ? (
                              <small>{c.value.slice(0, 100)}</small>
                            ) : null}
                          </td>
                          <td>{c.role}</td>
                          <td>
                            <Pill
                              kind={c.requires_review ? "warning" : "neutral"}
                            >
                              {c.disabled
                                ? "ใช้ไม่ได้"
                                : c.requires_review
                                  ? "ต้องตรวจคำสั่ง"
                                  : "พร้อมเลือก"}
                            </Pill>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              disabled={c.disabled}
                              onClick={() => select(c)}
                            >
                              เลือก
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <EmptyRow cols={4}>
                        ไม่พบองค์ประกอบที่ควบคุมได้ในส่วนที่แสดงอยู่
                      </EmptyRow>
                    )}
                  </tbody>
                </table>
              </div>
              <details className="page-text">
                <summary>ข้อความที่อ่านได้จากหน้า</summary>
                <pre>{snapshot.text}</pre>
              </details>
              {snapshot.controls_truncated ? (
                <Note>มีองค์ประกอบอื่นนอกขอบเขตการอ่าน เลื่อนหน้าแล้วอ่านอีกครั้ง</Note>
              ) : null}
            </>
          ) : (
            <Empty title="อ่านหน้าปัจจุบันเพื่อเริ่มต้น">
              ระบบจะแสดงปุ่ม ช่องกรอก และข้อความที่มองเห็น
              <br />
              คุณจึงเลือกคำสั่งได้โดยไม่ต้องเขียนโค้ด
            </Empty>
          )}
          {screenshot && /^data:image\/jpeg;base64,/.test(screenshot) ? (
            <img
              className="screenshot-image"
              src={screenshot}
              alt="ภาพหน้าจอแท็บ Meta ที่เชื่อมต่อ"
            />
          ) : null}
        </Panel>
        <Panel title="สั่งงานองค์ประกอบ" className="action-panel">
          <form
            className="panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("action", submit);
            }}
          >
            <label htmlFor="target">เป้าหมาย</label>
            <select
              id="target"
              value={target}
              onChange={(e) => {
                const c = snapshot?.controls.find(
                  (c) => c.id === e.target.value,
                );
                if (c) select(c);
                else setTarget("");
              }}
              required
            >
              <option value="">เลือกจากรายการด้านซ้าย</option>
              {snapshot?.controls.map((c) => (
                <option key={c.id} value={c.id} disabled={c.disabled}>
                  {c.label || "องค์ประกอบไม่มีชื่อ"}
                </option>
              ))}
            </select>
            <label htmlFor="actionType">คำสั่ง</label>
            <select
              id="actionType"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="click">คลิก</option>
              <option value="fill">กรอกข้อความ / ตัวเลข</option>
              <option value="select">เลือกค่าในเมนู</option>
              <option value="check">เปลี่ยน checkbox / switch</option>
              <option value="press">ส่งปุ่มคีย์บอร์ด</option>
              <option value="upload">อัปโหลดรูป / วิดีโอ</option>
            </select>
            {action === "fill" ? (
              <div>
                <label htmlFor="actionValue">ค่าที่ต้องการ</label>
                <textarea
                  id="actionValue"
                  rows={3}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="ข้อความหรือตัวเลขที่ต้องการกรอก"
                />
              </div>
            ) : null}
            {action === "select" ? (
              <div>
                <label htmlFor="optionValue">ค่าตัวเลือก</label>
                <select
                  id="optionValue"
                  value={option}
                  onChange={(e) => setOption(e.target.value)}
                >
                  {control?.options?.length ? (
                    control.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))
                  ) : (
                    <option value="">เมนูแบบกำหนดเอง ให้ใช้การคลิกเปิด</option>
                  )}
                </select>
              </div>
            ) : null}
            {action === "check" ? (
              <div>
                <label htmlFor="checkedValue">สถานะที่ต้องการ</label>
                <select
                  id="checkedValue"
                  value={checked}
                  onChange={(e) => setChecked(e.target.value)}
                >
                  <option value="true">เลือก / เปิด</option>
                  <option value="false">ไม่เลือก / ปิด</option>
                </select>
              </div>
            ) : null}
            {action === "press" ? (
              <div>
                <label htmlFor="keyValue">ปุ่ม</label>
                <select
                  id="keyValue"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                >
                  {[
                    "Enter",
                    "Escape",
                    "ArrowDown",
                    "ArrowUp",
                    "ArrowLeft",
                    "ArrowRight",
                    " ",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {k === " " ? "Space" : k}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {action === "upload" ? (
              <div>
                <label htmlFor="mediaFile">ไฟล์</label>
                <input
                  id="mediaFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="hint">PNG, JPG, WebP หรือ MP4 ไม่เกิน 5 MB</p>
              </div>
            ) : null}
            <button
              type="submit"
              className="primary wide"
              disabled={uiBusy || !target || !canWrite}
            >
              ส่งคำสั่ง
            </button>
            <p className="hint">
              อ่านผลหลังทุกคำสั่ง เป้าหมายเดิมจะหมดอายุเมื่อหน้าเปลี่ยน
              การกดปุ่มไม่ยืนยันว่าโฆษณาเผยแพร่แล้ว
            </p>
          </form>
        </Panel>
      </div>
      <Panel title="นำทางและเลื่อนหน้า" className="below-panel">
        <div className="panel-form inline-form">
          <label htmlFor="destination">
            หน้าที่ต้องการเปิด
            <select
              id="destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              {[
                ["campaigns", "Campaigns"],
                ["adsets", "Ad Sets"],
                ["ads", "Ads"],
                ["creation", "สร้างโฆษณา"],
                ["business", "Business Suite"],
                ["custom", "ระบุ URL หน้า Meta"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {destination === "custom" ? (
            <label htmlFor="customUrl">
              URL หน้า Meta
              <input
                id="customUrl"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://business.facebook.com/latest/..."
              />
            </label>
          ) : null}
          <button
            className="secondary"
            disabled={uiBusy || !account}
            onClick={() =>
              act({
                command: "ui.navigate",
                url:
                  destination === "custom"
                    ? customUrl
                    : destination === "business"
                      ? "https://business.facebook.com/latest/home"
                      : `https://adsmanager.facebook.com/adsmanager/${destination === "creation" ? "creation" : `manage/${destination}`}?act=${account}`,
              })
            }
          >
            เปิดหน้า
          </button>
          <button
            className="secondary"
            disabled={uiBusy}
            onClick={() =>
              act({
                command: "ui.action",
                action: { type: "scroll", delta_y: -700 },
              })
            }
          >
            เลื่อนขึ้น
          </button>
          <button
            className="secondary"
            disabled={uiBusy}
            onClick={() =>
              act({
                command: "ui.action",
                action: { type: "scroll", delta_y: 700 },
              })
            }
          >
            เลื่อนลง
          </button>
        </div>
      </Panel>
      <Panel
        title="รวบรวมตารางอัตโนมัติ"
        className="below-panel"
        action={
          <Pill
            kind={
              reading
                ? "success"
                : job?.status === "error"
                  ? "error"
                  : "neutral"
            }
          >
            {jobNames[job?.status ?? ""] ?? "ยังไม่มีงาน"}
          </Pill>
        }
      >
        <div className="panel-form">
          <div className="collection-options">
            {[
              ["campaigns", "Campaigns"],
              ["adsets", "Ad Sets"],
              ["ads", "Ads"],
            ].map(([v, label]) => (
              <label key={v}>
                <input
                  type="checkbox"
                  checked={levels.includes(v)}
                  onChange={(e) =>
                    setLevels((old) =>
                      e.target.checked
                        ? [...old, v]
                        : old.filter((l) => l !== v),
                    )
                  }
                />
                {label}
              </label>
            ))}
            <label className="steps-label">
              รอบอ่านต่อหน้า
              <input
                type="number"
                min={1}
                max={20}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="button-group">
            <button
              className="primary"
              disabled={busy || !device || !levels.length || reading}
              onClick={() => act({ command: "start", levels, maxSteps: steps })}
            >
              เริ่มรวบรวม
            </button>
            <button
              className="secondary"
              disabled={busy || !device}
              onClick={() => act({ command: "pause" })}
            >
              พักงาน
            </button>
            <button
              className="secondary"
              disabled={
                busy ||
                !device ||
                !job ||
                reading ||
                job.index >= job.levels.length
              }
              onClick={() => act({ command: "resume" })}
            >
              ทำต่อ
            </button>
            <button
              className="secondary"
              disabled={busy || !device}
              onClick={() => act({ command: "status" })}
            >
              อ่านสถานะ
            </button>
            <button
              className="text-button"
              disabled={!job}
              onClick={() =>
                download(
                  JSON.stringify(job, null, 2),
                  "collection-checkpoint.json",
                )
              }
            >
              ส่งออกข้อมูลที่รวบรวม
            </button>
          </div>
          <p className="hint">
            {job
              ? `อ่านได้ ${job.snapshots.length} ภาพรวม • หน้า ${job.levels[job.index] ?? "จบเส้นทางที่เลือก"}${job.error ? " • " + job.error : ""} • ความครบทั้งบัญชียังไม่ยืนยัน`
              : "อ่านเฉพาะแถวและคอลัมน์ที่แสดงอยู่บนหน้า ไม่รับรองความครบทั้งบัญชี"}
          </p>
        </div>
      </Panel>
    </>
  );
}
