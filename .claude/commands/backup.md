# /backup — Local Backup to External Drive

You are creating a local rsync backup of the fum_project to an external drive mounted at `/mnt/f` in WSL2.

## Overview

This skill mirrors the entire fum_project directory to the external F: drive, excluding build artifacts and dependencies. It uses rsync for incremental syncing — only changed files are transferred after the first run.

## Step 1: Verify Drive is Mounted

Check if the external drive is mounted:

```bash
mountpoint -q /mnt/f && echo "MOUNTED" || echo "NOT_MOUNTED"
```

Also verify it's a real drvfs mount (not just an empty directory):

```bash
mount | grep "/mnt/f"
```

**If NOT mounted**, auto-mount it (passwordless sudo is configured for this command):

```bash
sudo mount -t drvfs F: /mnt/f
```

Then re-check with `mountpoint -q /mnt/f`. If it still fails, tell the user:
> Could not mount the F: drive. Make sure the external drive is plugged in and shows as F: in Windows File Explorer. If the drive letter changed, remount manually:
> ```
> sudo mount -t drvfs <LETTER>: /mnt/f
> ```

**Stop here** if the drive cannot be mounted. Do not proceed.

**If mounted:** Show the drive's available space:
```bash
df -h /mnt/f
```

If available space is less than 500MB, warn the user and ask if they want to continue.

## Step 2: Run the Backup

The backup destination is `/mnt/f/backups/fum_project/`.

Run rsync with these options:

```bash
rsync -av --delete \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='dist/' \
  --exclude='coverage/' \
  --exclude='artifacts/' \
  --exclude='cache/' \
  --exclude='.claude/worktrees/' \
  /home/dnice/code/fum_project/ \
  /mnt/f/backups/fum_project/
```

**Flags explained:**
- `-a` — archive mode (preserves permissions, timestamps, symlinks)
- `-v` — verbose (show files being transferred)
- `--delete` — remove files from destination that no longer exist in source (keeps it a true mirror)

**Important:** The trailing `/` on the source path is required — it syncs the contents of fum_project into the destination, not fum_project itself.

Use a timeout of 600000 (10 minutes) for the rsync command.

## Step 3: Verify and Summarize

After rsync completes successfully, show:

1. **Backup location**: `/mnt/f/backups/fum_project/`
2. **Backup size**: Run `du -sh /mnt/f/backups/fum_project/`
3. **Timestamp**: Current date/time
4. **Quick verification**: Run `ls /mnt/f/backups/fum_project/` to confirm the top-level structure looks right (should show fum/, fum_library/, fum_automation/, fum_testing/, CLAUDE.md, etc.)

If rsync failed, show the error output and suggest troubleshooting steps:
- Check if the drive was disconnected
- Check available space
- Try remounting: `sudo mount -t drvfs F: /mnt/f`

## Rules

- **Never proceed without a mounted drive.** Always verify the mount first.
- **Use `--delete` by default.** The backup should be a true mirror. If files were deleted from the project, they should be deleted from the backup too.
- **Don't back up secrets.** If `.env` files exist in the project, warn the user that they will be included in the backup and ask if that's OK. If unsure, add `--exclude='.env*'` to the rsync command.
- **Show progress.** The rsync verbose output lets the user see what's happening.
