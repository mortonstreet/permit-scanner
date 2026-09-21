#!/usr/bin/env python3
"""
Download the Florida SunBiz public bulk files.

Credentials are published in plaintext by the state on
dos.fl.gov/sunbiz/other-services/data-downloads/ - this is intended public
access, not a bypass.

  quarterly corporate snapshot  cordata.zip        ~1.8 GB  -> officers + agents
  quarterly email index         email_YYYY_qN.zip  ~135 MB  -> doc number -> email

The server drops parallel/prefetching connections with "insufficient
resources", so this reads single-threaded in modest chunks.
"""
import sys, os, time, paramiko

HOST, USER, PW = "sftp.floridados.gov", "Public", "PubAccess1845!"
OUT = os.environ.get("SUNBIZ_DATA_DIR") or os.path.expanduser("~/.permit-stack-data")

CHUNK = 32 << 10        # the server drops larger sustained reads
MAX_ATTEMPTS = 40

def fetch(sftp_factory, remote, local):
    """Resumable, single-threaded, no prefetch.

    The SunBiz SFTP returns "insufficient resources" on prefetch or large
    sustained reads, so this crawls in 32 KB chunks and resumes from whatever
    is already on disk after a drop.
    """
    sftp = sftp_factory()
    size = sftp.stat(remote).st_size
    name = os.path.basename(local)

    if os.path.exists(local) and os.path.getsize(local) == size:
        print(f"  {name}: already complete ({size/1e6:.0f} MB)")
        return

    print(f"  {name}: {size/1e6:.0f} MB")
    t0 = time.time()

    for attempt in range(1, MAX_ATTEMPTS + 1):
        done = os.path.getsize(local) if os.path.exists(local) else 0
        if done >= size:
            break
        try:
            with sftp.open(remote, "rb") as fh, open(local, "ab") as out:
                fh.seek(done)
                last_report = done
                while done < size:
                    chunk = fh.read(CHUNK)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if done - last_report >= (16 << 20):
                        last_report = done
                        rate = done / max(time.time() - t0, 0.1) / 1e6
                        print(f"    {100*done/size:5.1f}%  {done/1e6:7.0f} MB  {rate:.2f} MB/s", flush=True)
        except Exception as e:
            print(f"    drop at {done/1e6:.0f} MB ({type(e).__name__}); resuming [{attempt}/{MAX_ATTEMPTS}]", flush=True)
            time.sleep(min(2 * attempt, 20))
            try:
                sftp.close()
            except Exception:
                pass
            sftp = sftp_factory()

    final = os.path.getsize(local) if os.path.exists(local) else 0
    status = "done" if final >= size else f"INCOMPLETE ({final/1e6:.0f}/{size/1e6:.0f} MB)"
    print(f"    {status} in {(time.time()-t0)/60:.1f} min")

def main():
    want = sys.argv[1:] or ["email", "cor"]
    os.makedirs(OUT, exist_ok=True)
    conns = []

    def connect():
        t = paramiko.Transport((HOST, 22)); t.banner_timeout = 60
        t.connect(username=USER, password=PW)
        c = paramiko.SFTPClient.from_transport(t)
        conns.append((t, c))
        return c

    try:
        probe = connect()
        if "email" in want:
            newest = sorted(f for f in probe.listdir("/Public/doc/DHE") if f.endswith(".zip"))[-1]
            fetch(connect, f"/Public/doc/DHE/{newest}", os.path.join(OUT, newest))
        if "cor" in want:
            fetch(connect, "/Public/doc/quarterly/cor/cordata.zip", os.path.join(OUT, "cordata.zip"))
    finally:
        for t, c in conns:
            try: c.close()
            except Exception: pass
            try: t.close()
            except Exception: pass

if __name__ == "__main__":
    main()
