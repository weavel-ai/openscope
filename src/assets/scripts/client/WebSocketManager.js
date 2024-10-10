import CommandParser from "./commands/parsers/CommandParser";
import { INVALID_NUMBER } from "./constants/globalConstants";

import { v4 as uuidv4 } from "uuid";
import { PARSED_COMMAND_NAME } from "./constants/inputConstants";
import AirportController from "./airport/AirportController";
import FixCollection from "./navigationLibrary/FixCollection";
import { radiansToDegrees, degreesToRadians } from "./utilities/unitConverters";

export default class WebSocketManager {
    constructor(aircraftController, inputController) {
        this.aircraftController = aircraftController;
        this.inputController = inputController;
        this.socket = null;
        this.uuid =
            localStorage.getItem("clientUUID") || this.generateAndStoreUUID();

        this.password = prompt("Please enter the password:");

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
        )}&password=${encodeURIComponent(this.password)}`;
        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
            console.log("WebSocket connection established");

            // if ("Notification" in window) {
            //     Notification.requestPermission().then(function (permission) {
            //         if (permission === "granted") {
            //             new Notification(
            //                 "Passing on control to AI. Airport Traffic Control is now on autopilot."
            //             );
            //         }
            //     });
            // }

            alert(
                "Passing on control to AI. Airport Traffic Control is now on autopilot."
            );
        };

        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        this.socket.onclose = (event) => {
            console.log("WebSocket connection closed");
            console.log("Close reason:", event.reason);
            console.log("Close code:", event.code);

            if (event.code === 1008) {
                alert("Authentication failed. Please check your password.");
                // Don't attempt to reconnect on auth failure
                return;
            }
            // Attempt to reconnect after a delay for other error codes
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

        if (parsedCommand.command !== PARSED_COMMAND_NAME.TRANSMIT) {
            const result = this.processSystemCommand(parsedCommand);
            this.sendResponse(correlation_id, result);
        } else {
            this.inputController.writeAndSubmitCommand(
                correlation_id,
                command,
                (correlation_id, message) => {
                    console.log("commandResult", message);
                    this.sendResponse(correlation_id, [true, message || ""]);
                    console.log("response sent");
                },
                (correlation_id, error) => {
                    console.error(`Error processing command: ${command}`);
                    console.error(error);
                    this.sendResponse(correlation_id, [false, error.message]);
                }
            );
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
            message: result[1] || "",
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
                const runwayDetails =
                    airportModel._runwayCollection.runways.reduce(
                        (acc, runway) => {
                            const landingLinePoints = [];
                            const lineLength = runway.length * 15;
                            const pointCount = 10;
                            const angleRad = (Math.PI / 2) * 3 - runway.angle;

                            for (let i = 0; i < pointCount; i++) {
                                const fraction = i / (pointCount - 1);
                                const x =
                                    runway._positionModel.x +
                                    lineLength * fraction * Math.cos(angleRad);
                                const y =
                                    runway._positionModel.y +
                                    lineLength * fraction * Math.sin(angleRad);
                                landingLinePoints.push([x, y]);
                            }
                            landingLinePoints.reverse();
                            acc[runway.name] = {
                                start_relative_x: runway._positionModel.x,
                                start_relative_y: runway._positionModel.y,
                                // end_relative_x:
                                //     runway._positionModel.x +
                                //     runway.length * Math.cos(runway.angle),
                                // end_relative_y:
                                //     runway._positionModel.y +
                                //     runway.length * Math.sin(runway.angle),
                                // angle: runway.angle,
                                length: runway.length,
                                landing_line: landingLinePoints,
                                taxi_queue: runway.queue.map((aircraftId) => {
                                    const aircraft =
                                        this.aircraftController.findAircraftById(
                                            aircraftId
                                        );
                                    return aircraft
                                        ? aircraft.callsign
                                        : aircraftId;
                                }),
                                // gps: runway.gps,
                            };
                            return acc;
                        },
                        {}
                    );
                // console.log("Runway details:", runwayDetails);
                return [true, runwayDetails];

            case PARSED_COMMAND_NAME.AIRCRAFT_DETAILS:
                const details = {};
                this.aircraftController.aircraft.list
                    .filter((aircraft) => aircraft.isControllable)
                    .forEach((aircraft) => {
                        details[aircraft.callsign] = {
                            heading: radiansToDegrees(aircraft.heading),
                            altitude: aircraft.altitude,
                            speed: aircraft.speed,
                            history: aircraft.history,
                            flightPhase: aircraft.flightPhase,
                            relativePosition: aircraft.relativePosition,
                            arrivalRunway:
                                aircraft.pilot._fms?.arrivalRunwayModel?.name ??
                                null,
                            relativePositionInOneMinute:
                                aircraft.getRelativePositionInOneMinute(),
                        };
                    });
                return [true, details];

            case PARSED_COMMAND_NAME.FIX_DETAILS:
                const fixDetails = FixCollection.findRealFixes();
                return [true, fixDetails];

            case PARSED_COMMAND_NAME.STRIP_DETAILS:
                const stripDetails =
                    this.aircraftController._stripViewController.getStripDetails();
                return [true, stripDetails];

            default:
                return [false, "Command not found"];
        }
    }
}
