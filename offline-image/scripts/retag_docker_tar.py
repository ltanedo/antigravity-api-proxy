#!/usr/bin/env python3
import io
import json
import sys
import tarfile


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: retag_docker_tar.py <input-tar> <output-tar> <repo-tag>",
            file=sys.stderr,
        )
        return 1

    input_tar, output_tar, repo_tag = sys.argv[1:4]

    with tarfile.open(input_tar, "r") as src:
        manifest_member = src.getmember("manifest.json")
        manifest = json.load(src.extractfile(manifest_member))
        manifest[0]["RepoTags"] = [repo_tag]
        manifest_bytes = json.dumps(manifest, separators=(",", ":")).encode("utf-8")

        with tarfile.open(output_tar, "w") as dst:
            for member in src.getmembers():
                if member.name == "manifest.json":
                    info = tarfile.TarInfo("manifest.json")
                    info.size = len(manifest_bytes)
                    info.mtime = member.mtime
                    info.mode = member.mode
                    info.uid = member.uid
                    info.gid = member.gid
                    info.uname = member.uname
                    info.gname = member.gname
                    dst.addfile(info, io.BytesIO(manifest_bytes))
                else:
                    extracted = src.extractfile(member) if member.isfile() else None
                    dst.addfile(member, extracted)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
