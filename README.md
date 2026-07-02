# Qualitative Analysis

A lightweight local qualitative analysis tool for transcribing and coding videos. 

## Requirements

- Python 3 (already installed on most Macs — check with `python3 --version` in Terminal)
- Any browser (tested on chrome)

## Getting started

1. Download/clone this folder.
2. Put your video files in `videos/` and any existing transcripts in `transcripts/`.
3. Double-click **`Start Qualitative Analysis.command`** on Mac, or **`Start Qualitative Analysis.bat`** on windows to start. This will open a browser tab and a console/terminal window.
4. Keep that terminal window open while you work as it's what's serving the app. Closing it stops the app.

If macOS blocks the `.command` file the first time (unidentified developer), right-click it and choose **Open**.

## Folders

- `videos/`: your source video files (`.mp4`, `.mov`, etc.)
- `transcripts/`: transcript files (`.tsv`, `.csv`, `.xls`, or `.xlsx`)
- `projects/`: small json files pairing a video with a transcript, created by "Save Project" button in interface. You can make your own too.

Drop new files into `videos/` or `transcripts/` any time. They'll show up in the app's lists next time you load/refresh.

## Basic usage

- **Load a video**, then use the keyboard to transcribe: 
	- hold up arrow to play, release up arrow to pause and rewind 0.5 seconds; 
	- hold left arrow for rewind and 
	- hold right for fast-forward. 
Hotkeys are rebindable in the settings (gear icon). 
You can resize video using the slider on the left of the screen. And you can drag and drop the video anywhere you want on the screen as you work.
- **The transcript is a spreadsheet** — click any cell to edit, add rows/columns as needed, rename columns from the header.
	- tab moves right a cell
	- shift + tab moves left a cell
	- shift + up moves up a cell
	- shift + down moves down a cell
You can resize the transcript width and height by clicking the button "Resize Transcript" at top of page. 
You can resize the columns similar to excel. And you can delete columns under button "Columns" at top of page (did not want accidental mistakes)
- **Coding**: add a column for a code category (specify type code column under button "Columns" at top of page). In the cell click "+ add code" and either search or create new codes. You can also use the Coding Panel to filter and count them.
- **Merging cells**: click a cell, shift-click another in the same column, then "Merge Cells". I found this useful for a note or behavior that spans several rows.
- **Save Transcript** writes back to its file in `transcripts/`. 
- **Save Project** links the current video + transcript together in `projects/`. And saves current transcript. 
- **Export Copy** downloads a standalone copy of transcript.

## Notes

- Your data never leaves your computer, everything is read from and written to these folders.
- Real `.xlsx` files can be opened, but the app always *saves* in its own `.xls` format (a plain HTML table Excel/Numbers/Sheets can open) so merged cells are preserved.
