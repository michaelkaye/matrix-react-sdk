/*
Copyright 2023 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { ForwardedRef, forwardRef } from "react";
import { FormattingFunctions, MappedSuggestion } from "@matrix-org/matrix-wysiwyg";

import { useRoomContext } from "../../../../../contexts/RoomContext";
import Autocomplete from "../../Autocomplete";
import { ICompletion } from "../../../../../autocomplete/Autocompleter";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { getMentionDisplayText, getMentionAttributes, buildQuery } from "../utils/autocomplete";

interface WysiwygAutocompleteProps {
    /**
     * The suggestion output from the rust model is used to build the query that is
     * passed to the `<Autocomplete />` component
     */
    suggestion: MappedSuggestion | null;

    /**
     * This handler will be called with the href and display text for a mention on clicking
     * a mention in the autocomplete list or pressing enter on a selected item
     */
    handleMention: FormattingFunctions["mention"];
}

/**
 * Given the current suggestion from the rust model and a handler function, this component
 * will display the legacy `<Autocomplete />` component (as used in the BasicMessageComposer)
 * and call the handler function with the required arguments when a mention is selected
 *
 * @param props.ref - the ref will be attached to the rendered `<Autocomplete />` component
 */
const WysiwygAutocomplete = forwardRef(
    ({ suggestion, handleMention }: WysiwygAutocompleteProps, ref: ForwardedRef<Autocomplete>): JSX.Element | null => {
        const { room } = useRoomContext();
        const client = useMatrixClientContext();

        function handleConfirm(completion: ICompletion): void {
            // TODO handle all of the completion types
            // Using this to pick out the ones we can handle during implementation
            if (client && room && completion.href && (completion.type === "room" || completion.type === "user")) {
                handleMention(
                    completion.href,
                    getMentionDisplayText(completion, client),
                    getMentionAttributes(completion, client, room),
                );
            }
        }

        return room ? (
            <div className="mx_WysiwygComposer_AutoCompleteWrapper" data-testid="autocomplete-wrapper">
                <Autocomplete
                    ref={ref}
                    query={buildQuery(suggestion)}
                    onConfirm={handleConfirm}
                    selection={{ start: 0, end: 0 }}
                    room={room}
                />
            </div>
        ) : null;
    },
);

WysiwygAutocomplete.displayName = "WysiwygAutocomplete";

export { WysiwygAutocomplete };
