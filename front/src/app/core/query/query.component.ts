import { Component, HostListener, Inject, OnDestroy, OnInit } from '@angular/core';
import { Table } from "../../../classes/table";
import { ActivatedRoute, Router } from "@angular/router";
import { DiffEditorModel } from "ngx-monaco-editor-v2";
import { MatTableDataSource } from "@angular/material/table";
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from "@angular/material/dialog";
import { HttpClient } from "@angular/common/http";
import { Server } from "../../../classes/server";
import { Database } from "../../../classes/database";
import { RequestService } from "../../../shared/request.service";
import { Relation } from "../../../classes/relation";
import { Configuration } from "../../../classes/configuration";
import { HistoryService, Query } from "../../../shared/history.service";
import { initBaseEditor, isSQL, REMOVED_LABELS } from "../../../shared/helper";
import { ExportResultDialog } from "../../../shared/export-result-dialog/export-result-dialog";
import { MatPaginatorIntl } from "@angular/material/paginator";
import { DrawerService } from "../../../shared/drawer.service";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MatSnackBar } from "@angular/material/snack-bar";
import helper from "../../../shared/common-helper.mjs";

declare var monaco: any;

@Component({
	selector: 'app-query',
	templateUrl: './query.component.html',
	styleUrls: ['./query.component.scss'],
	providers: [{provide: MatPaginatorIntl, useValue: new REMOVED_LABELS()} ]
})
export class QueryComponent implements OnInit, OnDestroy {

	templates!: string[];
	configuration: Configuration = new Configuration();
	selectedServer?: Server;
	selectedDatabase?: Database;
	selectedTable?: Table;
	relations?: Relation[];
	editors: any[] = [];
	editorOptions = {
		language: ''
	};
	originalResult: DiffEditorModel = {
		code: '',
		language: 'json'
	};
	modifiedResult: DiffEditorModel = {
		code: '',
		language: 'json'
	};
	query = '';
	query2 = '';
	diff = false;
	pageSize = 50;
	page = 0;
	querySize!: number;
	interval?: NodeJS.Timer;
	isLoading = false;
	displayedColumns?: string[];
	dataSource?: MatTableDataSource<any>;
	autoFormat = true;
	protected readonly Math = Math;

	constructor(
		private request: RequestService,
		private dialog: MatDialog,
		private http: HttpClient,
		private history: HistoryService,
		private activatedRoute: ActivatedRoute,
		private router: Router,
		private drawer: DrawerService
	) {
	}

	@HostListener('window:keydown', ['$event'])
	async onKeyDown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && ['Enter', 's'].indexOf(event.key) >= 0) {
			await this.runQuery();
			event.preventDefault();
		}
		if (event.altKey && event.code === "Space") {
			this.editors[0].trigger('', 'editor.action.triggerSuggest', '');
			event.preventDefault();
		}
	}

	async ngOnInit() {
		this.selectedServer = Server.getSelected();
		this.selectedDatabase = Database.getSelected();
		this.editorOptions.language = this.selectedServer?.driver.language.id!;

		this.activatedRoute.parent?.params.subscribe(async (_params) => {
			this.selectedTable = Table.getSelected();
			this.relations = Table.getRelations();
			this.querySize = -1;
			this.dataSource = new MatTableDataSource<any>();
			if (this.editors.length && monaco) {
				monaco.editor.setModelMarkers(this.editors[0].getModel(), "owner", []);
			}

			this.templates = this.selectedTable.view ? ['select', 'select_join'] : ['select', 'select_join', 'update', 'insert', 'delete'];
			this.loadTemplate("select");
			if (!isSQL()) {
				this.templates.push('aggregate');
			}
		});

		this.activatedRoute?.paramMap.subscribe(async (paramMap) => {
			if (paramMap.get('code') && paramMap.get('code')?.trim()) {
				this.query = paramMap.get('code')!;
			}
		});

		this.interval = setInterval(() => {
			this.router.navigate([Server.getSelected().name, Database.getSelected().name, Table.getSelected().name, 'query', this.query]);
		}, 1000);
	}

	ngOnDestroy() {
		clearInterval(this.interval);
	}

	async initEditor(editor: any, index: number) {
		initBaseEditor(editor);
		this.editors[index] = editor;
		await this.selectedServer?.driver.loadExtraLib(this.http);
	}

	async runQuery() {
		this.isLoading = true;

		try {
			if (this.diff) {
				await this._runCompare();
			} else {
				await this._runSingle();
			}
			if (this.autoFormat) {
				setTimeout(() => this.editors.map(editor => editor.trigger("editor", "editor.action.formatDocument")), 1);
			}
		} catch (e) {}
		finally {
			this.isLoading = false;
		}
	}

	addMonacoError(editor: any, error: any) {
		const pos = +error.position || 0;
		const startLineNumber = this.query.substring(0, pos).split(/\r\n|\r|\n/).length;

		monaco.editor.setModelMarkers(editor.getModel(), "owner", [{
			startLineNumber: startLineNumber,
			startColumn: 0,
			endLineNumber: +error.position ? startLineNumber : Infinity,
			endColumn: Infinity,
			message: error.error,
			severity: monaco.MarkerSeverity.Error
		}]);
	}

	async _runSingle() {
		let result = [];

		try {
			await Promise.all([
				result = await this.request.post('database/query', {
					query: this.query,
					pageSize: this.pageSize,
					page: this.page
				}),
				this.querySize = await this.request.post('database/querySize', {query: this.query})
			]);
		} catch (result: any) {
			this.addMonacoError(this.editors[0], result.error);
			this.dataSource = new MatTableDataSource();
			return;
		}

		if (this.querySize === 0) {
			result.push({" ": "No Data"});
		} else {
			this.history.addLocal(new Query(this.query, this.querySize));
		}
		if (!Array.isArray(result)) {
			result = [result];
		}

		this.displayedColumns = [...new Set(result.flatMap(res => Object.keys(res)))];
		this.dataSource = new MatTableDataSource(result);
	}

	async _runCompare() {
		const run = async (query: string, editor: any) => {
			let data;
			try {
				data = await this.request.post('database/query', {
					query,
					pageSize: this.pageSize,
					page: this.page
				});
				this.history.addLocal(new Query(query, data.length));
			} catch (result: any) {
				this.addMonacoError(editor, result.error);
			}

			return JSON.stringify(data, null, "\t");
		}

		this.querySize = 10000;
		[this.originalResult.code, this.modifiedResult.code] = await Promise.all([run(this.query, this.editors[0]), run(this.query2, this.editors[1])]);
	}

	loadTemplate(value: string) {
		switch (value) {
			case "delete":
				this.query = this.selectedServer!.driver.getBaseDelete(this.selectedTable!);
				break;
			case "insert":
				this.query = this.selectedServer!.driver.getBaseInsert(this.selectedTable!);
				break;
			case "update":
				this.query = this.selectedServer!.driver.getBaseUpdate(this.selectedTable!);
				break;
			case "select":
				this.query = this.selectedServer!.driver.getBaseSelect(this.selectedTable!);
				break;
			case "select_join":
				this.query = this.selectedServer!.driver.getBaseSelectWithRelations(this.selectedTable!, this.relations!);
				break;
			case "aggregate":
				this.query = this.selectedServer!.driver.getBaseAggregate!(this.selectedTable!);
				break;
		}
		if (this.autoFormat) {
			setTimeout(() => this.editors.map(editor => editor.trigger("editor", "editor.action.formatDocument")), 1);
		}
	}

	exportQuery() {
		this.dialog.open(ExportQueryDialog, {
			data: helper.removeComment(this.query),
			hasBackdrop: false
		});
	}

	async exportResult() {
		this.isLoading = true;
		const data = await this.request.post('database/query', {
			query: this.query,
			pageSize: this.querySize,
			page: 0
		});
		this.isLoading = false;
		this.dialog.open(ExportResultDialog, {
			data,
			hasBackdrop: false
		});
	}

	addView() {
		this.dialog.open(CreateViewDialog, {
			hasBackdrop: false,
			data: this.selectedServer?.driver.extractForView(helper.removeComment(this.query))
		});
	}

	isQuerySelect() {
		return this.selectedServer?.driver.extractForView(helper.removeComment(this.query));
	}
}

@Component({
	templateUrl: 'export-query-dialog.html',
})
export class ExportQueryDialog {

	str!: string;
	framework = "NODE";
	isLoading = true;
	editorOptions = {
		language: ""
	};
	protected readonly initBaseEditor = initBaseEditor;

	constructor(
		@Inject(MAT_DIALOG_DATA) public data: string,
	) {
		this.show();
	}

	show() {
		this.isLoading = true;

		setTimeout(() => {
			const queryParams = Server.getSelected().driver.extractConditionParams(this.data);

			switch (this.framework) {
				case "JDBC":
					this.str = `//with JDBC lib

import java.sql.*;

class MysqlCon {
	public static void main(String args[]){
	try {
		Class.forName("com.${Server.getSelected().wrapper.toLowerCase()}.Driver");
		Connection con = DriverManager.getConnection("jdbc:${Server.getSelected().wrapper.toLowerCase()}://${Server.getSelected().host}:${Server.getSelected().port}/${Database.getSelected().name}", "${Server.getSelected().user}", "${Server.getSelected().password}");

		String query = """
			${queryParams.query}
		"""
		PreparedStatement pstmt = connection.prepareStatement( query );

		ResultSet results = pstmt.executeQuery( );
		con.close();
	} catch(Exception e) {}
}`;
					this.editorOptions.language = "java";
					break;
				case "NODE":
					this.str = Server.getSelected().driver.nodeLib(queryParams);
					this.editorOptions.language = "javascript";
					break;
				case "PDO":
					this.str = `//with PDO lib
<?php

	$pdo = new PDO("${Server.getSelected().wrapper.toLowerCase()}:host=${Server.getSelected().host};port=${Server.getSelected().port};dbname=${Database.getSelected().name};user=${Server.getSelected().user};password=${Server.getSelected().password}");

	$query = $pdo->prepare(\`${queryParams.query}\`);
	$query->execute([]);
	$results = $query->fetchAll();

?>`;
					this.editorOptions.language = "php";
					break;
			}
			this.isLoading = false;
		});
	}
}

@Component({
	templateUrl: 'create-view-dialog.html',
})
export class CreateViewDialog {

	form!: FormGroup;

	constructor(
		private dialogRef: MatDialogRef<CreateViewDialog>,
		private fb: FormBuilder,
		private request: RequestService,
		private router: Router,
		private snackBar: MatSnackBar,
		@Inject(MAT_DIALOG_DATA) public code: string
	) {
		this.form = fb.group({
			name: [null, [Validators.required, Validators.pattern(helper.validName)]],
			code: [code]
		});
	}

	async create() {
		await this.request.post('table/createView', this.form.value);
		await this.request.reloadServer();

		await this.router.navigate([
			Server.getSelected().name,
			Database.getSelected().name,
			this.form.get('name')?.value,
			'structure']);

		this.snackBar.open(`View ${this.form.get('name')?.value} Created`, "╳", {duration: 3000});
		this.dialogRef.close(true);
	}
}

