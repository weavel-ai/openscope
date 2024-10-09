import CommandParser from "./commands/parsers/CommandParser";
import { INVALID_NUMBER } from "./constants/globalConstants";

import { v4 as uuidv4 } from "uuid";
import { PARSED_COMMAND_NAME } from "./constants/inputConstants";
import AirportController from "./airport/AirportController";

export default class WebSocketManager {
    constructor(aircraftController) {
        this.aircraftController = aircraftController;
        this.socket = null;
        this.uuid =
            localStorage.getItem("clientUUID") || this.generateAndStoreUUID();
        this.connect();
    }

    generateAndStoreUUID() {
        const newUUID = uuidv4();
        localStorage.setItem("clientUUID", newUUID);
        return newUUID;
    }

    connect() {
        console.log("Connecting to WebSocket...");
        const url = `ws://localhost:8000/ws/open?authorization=${encodeURIComponent(
            this.uuid
        )}`;
        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
            console.log("WebSocket connection established");
        };

        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        this.socket.onclose = () => {
            console.log("WebSocket connection closed");
            // Attempt to reconnect after a delay
            setTimeout(() => this.connect(), 5000);
        };
    }

    /**
     * Handles incoming WebSocket messages
     *
     * @param {Object} message - The received message object
     * @param {string} message.command - The command to be executed (e.g. rd, AAL123 spos, etc.)
     * @param {string} message.aircraftId - The ID of the aircraft to execute the command on
     * @param {Array} message.args - Additional arguments for the command (unused)
     *
     * @returns {array} [success of operation, response]
     */
    handleMessage(message) {
        const { command, correlation_id } = message;

        const parser = new CommandParser(command);
        const parsedCommand = parser.parse();

        try {
            let result;

            if (parsedCommand.command !== PARSED_COMMAND_NAME.TRANSMIT) {
                result = this.processSystemCommand(parsedCommand);
            } else {
                // console.log("command", parsedCommand);
                const aircraft = this.aircraftController.findAircraftByCallsign(
                    parsedCommand.callsign
                );
                // console.log("aircraft", aircraft);
                if (!aircraft) {
                    console.error(
                        `Aircraft with callsign ${parsedCommand.callsign} not found`
                    );
                    return;
                }
                result = this.processTransmitCommand(aircraft, parsedCommand);
                // console.log("result", result);
            }
            this.sendResponse(correlation_id, result);
            console.log("response sent");
        } catch (error) {
            console.error(`Command not understood: ${command}`);
            console.error(error);
            this.sendResponse(correlation_id, [false, error.message]);
        }
    }

    /**
     * Sends a response back to the client via WebSocket
     *
     * @param {string} correlation_id - The correlation ID of the original request
     * @param {Array} result - An array containing [success, message]
     * @param {boolean} result[0] - Indicates if the operation was successful
     * @param {string} result[1] - The response message
     */
    sendResponse(correlation_id, result) {
        const response = {
            correlation_id,
            success: result[0],
            message: result[1],
        };
        this.socket.send(JSON.stringify(response));
    }

    /**
     * @for InputController
     * @method processTransmitCommand
     * @param parsedCommand {ParsedCommand}
     * @return {boolean}
     */
    processTransmitCommand(aircraft, parsedCommand) {
        // TODO: abstract the aircraft callsign matching
        let matches = 0;
        let match = INVALID_NUMBER;

        for (let i = 0; i < this.aircraftController.aircraft.list.length; i++) {
            const aircraft = this.aircraftController.aircraft.list[i];

            if (aircraft.matchCallsign(parsedCommand.callsign)) {
                matches += 1;
                match = i;
            }
        }

        if (matches > 1) {
            throw new Error("multiple aircraft match the callsign, say again");
        }

        if (match === INVALID_NUMBER) {
            throw new Error("no such aircraft, say again");
        }

        return parsedCommand.commandList.reduce(
            (_, command) => {
                return this.aircraftController.aircraftCommander.run(
                    aircraft,
                    command.name,
                    command.args
                );
            },
            [true, ""]
        );
    }

    /**
     * @for WebSocketManager
     * @method processSystemCommand
     * @param parsedCommand {ParsedCommand}
     * @return {array} [success of operation, response]
     */
    processSystemCommand(parsedCommand) {
        // console.log("parsedCommand in processSystemCommand", parsedCommand);
        switch (parsedCommand.command) {
            case PARSED_COMMAND_NAME.RUNWAY_DETAILS:
                // console.log("Running runway details command");
                const airportModel = AirportController.airport_get();
                const runwayDetails = airportModel.getRunwayDetails();
                // console.log("Runway details:", runwayDetails);
                return [true, runwayDetails];

            case PARSED_COMMAND_NAME.AIRCRAFT_DETAILS:
                // console.log("Running aircraft details command");
                const aircraftDetails =
                    this.aircraftController.getAircraftsInfo();
                // console.log("Aircraft details:", aircraftDetails);
                return [true, aircraftDetails];

            case PARSED_COMMAND_NAME.DEPARTURE_LIST:
                // console.log("Running departure list command");
                const departureList =
                    this.aircraftController._stripViewController.getDeparturesInfo();
                // console.log("Departure list:", departureList);
                return [true, departureList];

            case PARSED_COMMAND_NAME.ARRIVAL_LIST:
                // console.log("Running arrival list command");
                const arrivalList =
                    this.aircraftController._stripViewController.getArrivalsInfo();
                // console.log("Arrival list:", arrivalList);
                return [true, arrivalList];

            default:
                return [false, "Command not found"];
        }
    }
}
