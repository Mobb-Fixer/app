import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { RequestService } from "../request.service";
import { Table } from "../../classes/table";
import { Server } from "../../classes/server";

@Component({
	selector: 'app-update-data-dialog',
	templateUrl: './update-data-dialog.component.html',
	styleUrls: ['./update-data-dialog.component.scss']
})
export class UpdateDataDialogComponent {

	updateSuggestions: { [key: string]: string[] } = {};
	str = "";
	editorOptions = {
		language: 'json'
	};

	constructor(
		public dialogRef: MatDialogRef<UpdateDataDialogComponent>,
		public snackBar: MatSnackBar,
		private request: RequestService,
		@Inject(MAT_DIALOG_DATA) public old: any,
	) {
		this.str = JSON.stringify(old, null, "\t");
		this.loadSuggestions();
	}

	async update() {
		const n = JSON.parse(this.str);
		const nb = await this.request.post('data/update', {old_data: this.old, new_data: n});

		this.snackBar.open(`${nb} row(s) updated`, "╳", {duration: 3000});
		this.dialogRef.close(n);
	}

	isTouched() {
		return JSON.stringify(this.old, null, "\t") !== this.str;
	}

	async loadSuggestions() {
		const relations = Table.getRelations();
		const limit = 1000;

		for (const col of Table.getSelected().columns) {
			const enums = Server.getSelected().driver.extractEnum(col);
			if (enums) {
				this.updateSuggestions[col.name] = enums;
				continue;
			}

			if (relations.find(relation => relation.column_source === col.name)) {
				const datas = await this.request.post('relation/exampleData', {column: col.name, limit});
				if (datas && datas.length < limit) {
					this.updateSuggestions[col.name] = datas.map((data: any) => data.example);
				}
			}
		}
	}
}