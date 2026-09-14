#!/usr/bin/env python3
"""Consistent SQLite backup with integrity verification and rotation."""
import argparse,sqlite3
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
TZ=ZoneInfo("Europe/Berlin")
def main():
 p=argparse.ArgumentParser();p.add_argument("--database",type=Path,required=True);p.add_argument("--output",type=Path,required=True);p.add_argument("--keep-days",type=int,default=14);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 stamp=datetime.now(TZ);target=a.output/f"moviepark-{stamp:%Y%m%d-%H%M%S}.sqlite";source=sqlite3.connect(f"file:{a.database}?mode=ro",uri=True);dest=sqlite3.connect(target)
 try:source.backup(dest);result=dest.execute("PRAGMA integrity_check").fetchone()[0]
 finally:dest.close();source.close()
 if result!="ok":target.unlink(missing_ok=True);raise RuntimeError(f"backup integrity check: {result}")
 cutoff=stamp-timedelta(days=a.keep_days)
 for item in a.output.glob("moviepark-*.sqlite"):
  if datetime.fromtimestamp(item.stat().st_mtime,TZ)<cutoff:item.unlink()
 print(f"backup={target} integrity=ok")
if __name__=="__main__":main()
