import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { BehaviorSubject, firstValueFrom } from "rxjs";
import { environment } from "../environments/environment";
import { Database } from "../classes/database";
import { Server } from "../classes/server";
import { Table } from "../classes/table";
import { Relation } from "../classes/relation";
import { Index } from "../classes";
import { MatSnackBar, MatSnackBarRef } from "@angular/material/snack-bar";

@Injectable({
	providedIn: 'root'
})
export class RequestService {

	private messageSource = new BehaviorSubject(<Server>{});
	serverReload = this.messageSource.asObservable();

	lastSnack?: MatSnackBarRef<any>;

	constructor(
		private http: HttpClient,
		private _snackBar: MatSnackBar,
	) {
	}

	async post(url: string, data: any,
			   table = Table.getSelected(),
			   database = Database.getSelected(),
			   server = Server.getSelected(),
			   headers = new HttpHeaders(),
			   snackError = true) {
		const shallow = Server.getShallow(server);

		headers = headers.set('Server', JSON.stringify(shallow));
		if (table) {
			headers = headers.set('Table', table.name)
		}
		if (database) {
			headers = headers.set('Database', database.name)
		}

		const result = await firstValueFrom(this.http.post<any>(
			environment.apiRootUrl + url, data, {headers}
		));
		if (this.lastSnack) {
			this.lastSnack.dismiss();
		}
		if (snackError && result.error) {
			this.lastSnack = this._snackBar.open(result.error, "╳", {panelClass: 'snack-error'});
			throw new HttpErrorResponse({statusText: result.error});
		}

		return result;
	}

	async reloadDbs(server = Server.getSelected()) {
		const shallow = Server.getShallow(server);

		await Promise.all([
			new Promise(async resolve => {
				server.dbs = await firstValueFrom(this.http.post<Database[]>(environment.apiRootUrl + 'server/structure', shallow))
				resolve(true);
			}),
			new Promise(async resolve => {
				server.relations = await firstValueFrom(this.http.post<Relation[]>(environment.apiRootUrl + 'server/relations', shallow))
				resolve(true);
			}),
			new Promise(async resolve => {
				server.indexes = await firstValueFrom(this.http.post<Index[]>(environment.apiRootUrl + 'server/indexes', shallow))
				resolve(true);
			}),
		]);

		if (server.name !== Server.getSelected()?.name) {
			return server;
		}

		Database.reload(server.dbs);
		Table.reload(Database.getSelected());

		this.messageSource.next(server);
		return server;
	}
}
