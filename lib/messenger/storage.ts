import { supabase } from '@/utils/supabase';

async function removeAttachmentPaths(paths: string[]) {
    if (paths.length === 0) {
        return { removed: 0 };
    }

    const { error: storageError } = await supabase.storage
        .from('chat-attachments')
        .remove(paths);

    if (storageError) {
        throw storageError;
    }

    return { removed: paths.length };
}

export async function deleteChatAttachmentObjects(chatId: string) {
    const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('attachments')
        .eq('chat_id', chatId);

    if (messagesError) {
        throw messagesError;
    }

    const paths = Array.from(new Set(
        (messages || [])
            .flatMap((message) => Array.isArray(message.attachments) ? message.attachments : [])
            .map((attachment: any) => typeof attachment?.path === 'string' ? attachment.path : null)
            .filter((value): value is string => Boolean(value))
    ));

    return removeAttachmentPaths(paths);
}

export async function deleteMessageAttachmentObjects(messageId: string) {
    const { data: message, error: messageError } = await supabase
        .from('messages')
        .select('attachments')
        .eq('id', messageId)
        .maybeSingle();

    if (messageError) {
        throw messageError;
    }

    const paths = Array.from(new Set(
        (Array.isArray(message?.attachments) ? message.attachments : [])
            .map((attachment: any) => typeof attachment?.path === 'string' ? attachment.path : null)
            .filter((value): value is string => Boolean(value))
    ));

    return removeAttachmentPaths(paths);
}