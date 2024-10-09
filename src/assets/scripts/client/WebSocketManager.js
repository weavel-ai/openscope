import CommandParser from "./commands/parsers/CommandParser";
import { INVALID_NUMBER } from "./constants/globalConstants";

import { v4 as uuidv4 } from "uuid";
import { PARSED_COMMAND_NAME } from "./constants/inputConstants";
import AirportController from "./airport/AirportController";

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
            this.inputController
                .writeAndSubmitCommand(command)
                .then((result) => {
                    console.log("commandResult", result);
                    if (result) {
                        this.sendResponse(correlation_id, result);
                        console.log("response sent");
                    }
                })
                .catch((error) => {
                    console.error(`Command not understood: ${command}`);
                    console.error(error);
                    this.sendResponse(correlation_id, [false, error.message]);
                });
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
                            const extendedLength = runway.length * 3;

                            // Calculate the direction vector based on the angle
                            const dx = extendedLength * Math.cos(runway.angle);
                            const dy = extendedLength * Math.sin(runway.angle);

                            // Calculate perpendicular vector for width
                            const halfWidth = runway.length / 2;
                            const perpAngle = runway.angle + Math.PI / 2;
                            const perpDx = halfWidth * Math.cos(perpAngle);
                            const perpDy = halfWidth * Math.sin(perpAngle);

                            // Calculate the four vertices

                            const point1 = {
                                x: runway._positionModel.x + perpDx,
                                y: runway._positionModel.y + perpDy,
                            };
                            const point2 = {
                                x: runway._positionModel.x - perpDx,
                                y: runway._positionModel.y - perpDy,
                            };
                            const point3 = {
                                x: runway._positionModel.x + perpDx - dx,
                                y: runway._positionModel.y + perpDy - dy,
                            };
                            const point4 = {
                                x: runway._positionModel.x - perpDx - dx,
                                y: runway._positionModel.y - perpDy - dy,
                            };
                            acc[runway.name] = {
                                start_relative_x: runway._positionModel.x,
                                start_relative_y: runway._positionModel.y,
                                // end_relative_x:
                                //     runway._positionModel.x +
                                //     runway.length * Math.cos(runway.angle),
                                // end_relative_y:
                                //     runway._positionModel.y +
                                //     runway.length * Math.sin(runway.angle),
                                landing_possible_airspace: [
                                    point1,
                                    point2,
                                    point3,
                                    point4,
                                ],
                                // angle: runway.angle,
                                length: runway.length,
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
